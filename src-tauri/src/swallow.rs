use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM, BOOL};
use windows::Win32::UI::WindowsAndMessaging::{
    SetParent, SetWindowLongPtrW, GetWindowLongPtrW, SetWindowPos, GetClassNameW,
    GWL_STYLE, GWL_EXSTYLE, WS_CAPTION, WS_THICKFRAME, WS_BORDER, WS_CHILD, WS_POPUP,
    WS_CLIPSIBLINGS, WS_EX_TOPMOST, WS_EX_APPWINDOW, WS_EX_MDICHILD,
    SWP_SHOWWINDOW, SWP_FRAMECHANGED, SWP_ASYNCWINDOWPOS, SWP_NOCOPYBITS,
    SWP_NOZORDER, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    EnumWindows, GetWindowThreadProcessId, IsWindowVisible, GetWindowTextW,
    EnumChildWindows, IsWindow, HWND_TOP, GetWindowRect, IsIconic, ShowWindow, SW_SHOWNOACTIVATE,
    SetForegroundWindow, BringWindowToTop, SetMenu, PostMessageW, WM_CLOSE,
};
use windows::Win32::Graphics::Gdi::{ScreenToClient, ClientToScreen, CreateRectRgn, CreateRoundRectRgn, SetWindowRgn, CombineRgn, DeleteObject, RGN_DIFF, HRGN, RedrawWindow, RDW_INVALIDATE, RDW_ERASE, RDW_ALLCHILDREN, RDW_UPDATENOW};
use windows::Win32::Foundation::{RECT, POINT};

use tauri::{AppHandle, Emitter};

// WIP dev-only file log (elevation detaches stderr from the console). Append to
// %TEMP%\hyperdesk-swallow.log. Remove with all dlog! calls once swallow is stable.
static DLOG_START: OnceLock<std::time::Instant> = OnceLock::new();

pub fn dlog(line: &str) {
    use std::io::Write;
    // 앱 시작 후 경과 ms — 실제 시각(달력)까지 필요한 적은 없었고, 필요한 건
    // "이 두 줄이 몇 ms 간격이었나/어느 게 먼저였나"뿐이다. chrono 없이 이거면
    // 충분하다(YAGNI). 여러 슬롯이 동시에 로그를 찍을 때 hwnd를 hex로 손 변환해
    // 시간순을 재구성해야 했던 게 실제로 겪은 문제라 추가한다.
    let ms = DLOG_START.get_or_init(std::time::Instant::now).elapsed().as_millis();
    let line = format!("[{ms:>8}ms] {line}");
    eprintln!("{}", line);
    let path = std::env::temp_dir().join("hyperdesk-swallow.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{}", line);
    }
}

#[cfg(debug_assertions)]
macro_rules! dlog {
    ($($arg:tt)*) => { crate::swallow::dlog(&format!($($arg)*)) };
}

// 릴리즈용 no-op. **이게 없으면 `#[cfg(debug_assertions)]` 블록 밖에서 dlog!를
// 부르는 순간 릴리즈 빌드만 "cannot find macro" 로 깨진다** — dev 빌드와
// `cargo test`는 멀쩡히 통과하므로 `v*` 태그를 밀어 릴리즈 워크플로가 돌 때에야
// 발견된다(실제로 그렇게 한 번 깨뜨렸다). 호출부마다 cfg 가드를 다는 대신
// 매크로를 양쪽 프로파일에 다 정의해서 함정 자체를 없앤다.
// 주의: 릴리즈에선 인자가 **평가되지 않는다**. dlog! 인자에 부수 효과가 있는
// 식(함수 호출로 상태를 바꾸는 것 등)을 넣지 말 것.
#[cfg(not(debug_assertions))]
macro_rules! dlog {
    ($($arg:tt)*) => {};
}

pub static SWALLOW_STATE: OnceLock<Arc<Mutex<HashMap<String, SwallowInfo>>>> = OnceLock::new();

fn swallow_state() -> &'static Arc<Mutex<HashMap<String, SwallowInfo>>> {
    SWALLOW_STATE.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

/// Locks SWALLOW_STATE, recovering the inner data if a prior holder panicked.
/// A panic while holding this lock must never cascade into every other
/// swallow/unswallow/focus call permanently failing (poisoned mutex).
pub fn lock_state() -> std::sync::MutexGuard<'static, HashMap<String, SwallowInfo>> {
    swallow_state().lock().unwrap_or_else(|e| e.into_inner())
}

/// hwnds a hunt loop has picked as ITS candidate but not yet committed to
/// SWALLOW_STATE (perform_swallow hasn't returned yet). SWALLOW_STATE alone
/// only excludes windows another slot has FINISHED swallowing — two slots
/// whose hunts pick the same candidate within the same poll tick (before
/// either reaches perform_swallow's insert) would otherwise both pass the
/// exclusion check and race to reparent the same window. Insert here the
/// instant a candidate is selected, remove once perform_swallow returns
/// (success or failure — SWALLOW_STATE itself is authoritative from then on).
static CLAIMED_HWNDS: OnceLock<Mutex<std::collections::HashSet<isize>>> = OnceLock::new();

fn claimed_hwnds() -> &'static Mutex<std::collections::HashSet<isize>> {
    CLAIMED_HWNDS.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

fn lock_claimed() -> std::sync::MutexGuard<'static, std::collections::HashSet<isize>> {
    claimed_hwnds().lock().unwrap_or_else(|e| e.into_inner())
}

/// Every hwnd a slot search must never re-pick: already-swallowed (SWALLOW_STATE)
/// union currently-being-claimed-by-another-hunt (CLAIMED_HWNDS).
/// 체인에서 **밀려난** 창들(로그인 → 런처 → 데스크톱으로 넘어가며 버려진 단계).
///
/// 한 번 `SW_HIDE` 하는 것만으로는 부족하다 — Horizon은 런처(대시보드)를 나중에
/// 스스로 다시 띄우고, 그게 컨테이너 안에서 데스크톱 위를 덮어 "HyperDesk 안에
/// Omnissa 대시보드가 떠 있는" 상태가 된다(실측 2026-09-03). 게다가 그 창에는
/// 헤더 필 구멍이 안 뚫려 있어 필까지 가려 드래그가 막힌다.
/// 그래서 목록으로 들고 안정화 루프가 매 폴 다시 숨긴다.
static SUPERSEDED: OnceLock<Mutex<HashMap<String, Vec<isize>>>> = OnceLock::new();

fn superseded() -> &'static Mutex<HashMap<String, Vec<isize>>> {
    SUPERSEDED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 밀려난 체인 창이 다시 보이면 도로 숨긴다.
fn keep_superseded_hidden(slot_id: &str) {
    let list: Vec<isize> = superseded()
        .lock().unwrap_or_else(|e| e.into_inner())
        .get(slot_id).cloned().unwrap_or_default();
    for raw in list {
        let h = HWND(raw as *mut _);
        unsafe {
            if IsWindow(h).as_bool() && IsWindowVisible(h).as_bool() {
                dlog!("[chain] slot={} re-hiding superseded window {:?}", slot_id, raw);
                let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(
                    h, windows::Win32::UI::WindowsAndMessaging::SW_HIDE);
            }
        }
    }
}

fn excluded_hwnds() -> Vec<isize> {
    let mut v: Vec<isize> = lock_state().values().map(|i| i.child_hwnd).collect();
    v.extend(lock_claimed().iter().copied());
    v
}

/// Per-slot attempt counter. Bumped on every `swallow()` call AND every
/// `unswallow()` call (cancel/disconnect) — whichever happens, it invalidates
/// any OLDER in-flight hunt thread for the same slot. Without this, cancelling
/// a slow connect (or disconnecting) leaves the original hunt thread running;
/// it can later find a window and commit it (SWALLOW_STATE insert +
/// swallow-success) well after the user thought they'd cancelled, or race a
/// second hunt spawned by an immediate reconnect to the same slot.
static SWALLOW_GEN: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();

fn swallow_gen_map() -> &'static Mutex<HashMap<String, u64>> {
    SWALLOW_GEN.get_or_init(|| Mutex::new(HashMap::new()))
}

fn bump_generation(slot_id: &str) -> u64 {
    let mut map = swallow_gen_map().lock().unwrap_or_else(|e| e.into_inner());
    let g = map.entry(slot_id.to_string()).or_insert(0);
    *g += 1;
    *g
}

fn current_generation(slot_id: &str) -> u64 {
    swallow_gen_map().lock().unwrap_or_else(|e| e.into_inner()).get(slot_id).copied().unwrap_or(0)
}

/// Mirrors MultiView.tsx's `anyConnecting` React state on the Rust side. The
/// Alt+1~4 global shortcut handler (lib.rs) runs entirely in Rust and has no
/// visibility into React state — without this, it kept force-focusing a
/// mid-connect slot's native window (SetForegroundWindow/BringWindowToTop)
/// even while the frontend lock disabled the UI buttons for exactly that.
static CONNECT_LOCK: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_connect_lock(locked: bool) {
    CONNECT_LOCK.store(locked, std::sync::atomic::Ordering::Relaxed);
}

pub fn is_connect_locked() -> bool {
    CONNECT_LOCK.load(std::sync::atomic::Ordering::Relaxed)
}

/// Pixel bounds of a grid slot, in WebView-container client coordinates.
#[derive(Clone, Copy)]
pub struct SlotBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Copy)]
pub struct SendHWND(pub HWND);
unsafe impl Send for SendHWND {}
unsafe impl Sync for SendHWND {}

pub struct SwallowInfo {
    pub child_hwnd: isize,
    pub original_style: isize,
    pub original_ex_style: isize,
    pub original_parent: isize,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub parent_hwnd: isize,
    pub is_visible: bool,
    pub class_name: String,
    /// Top-chrome mask resolved at swallow time (0 for RDP/Horizon, vmconnect's
    /// MEASURED ribbon height for Hyper-V — not the generic get_offset() guess).
    /// update_position must reuse this exact value on every later resize; recomputing
    /// via get_offset(class_name) only returns the HYPERV_OFFSET fallback constant,
    /// not the measured rect, so the ribbon mask would drift back to a wrong height
    /// (re-exposing the ribbon, or over-clipping the video) after the first resize.
    /// The stabilization loop re-measures it (session-mode switch) and keeps it fresh.
    pub offset: i32,
    /// Left inset of the content child inside the frame (vmconnect's WinForms
    /// panel sits ~3px in from the frame edge — without compensating, the
    /// rightmost few px of the VM surface are cropped by the slot).
    pub offset_x: i32,
    /// vmconnect's pid (Some for Hyper-V, None for RDP/Horizon). The connect-bar
    /// (BBarWindowClass) is created lazily and can REappear on focus/unmaximize
    /// between stabilization polls (1s when idle), so focus_window re-hides it
    /// immediately using this pid instead of waiting for the next poll.
    pub vmconnect_pid: Option<u32>,
    /// 떠 있는 헤더 필이 차지하는 사각형 — **슬롯 콘텐츠 영역 기준 상대 좌표**
    /// (물리 픽셀). 자식 창 좌표로의 변환은 `apply_chrome_region`이 적용 직전에
    /// 하므로 여기엔 변환 전 값을 그대로 둔다(vmconnect가 접속 직후 크롬 offset을
    /// 여러 번 재측정하는데, 미리 변환해두면 그때마다 낡은 좌표가 되어 필이 검게
    /// 덮인다 — apply_chrome_region의 주석 참고). 이 자리는 자식 창에서 도려내져
    /// 그 아래 DOM이 비쳐 보인다 — swallow된 자식이 WebView2 표면 위에 그려지므로
    /// z-index로는 필을 띄울 수 없다. None이면 구멍 없음.
    pub header_cutout: Option<CutoutRect>,
}

const DEFAULT_OFFSET: i32 = 0; // Styles successfully removed
const HYPERV_OFFSET: i32 = 30;  // Hyper-V Ribbon
const HORIZON_OFFSET: i32 = 0; // Horizon usually reacts well to style removal
const HORIZONTAL_BUFFER: i32 = 0; // Remove buffer for 1:1 fit at 100% DPI

/// 슬롯에 보이는 구간을 이만큼 **아래로** 옮긴다(= 내용이 위로 올라가고 아래가 더
/// 드러난다). 원격 데스크톱의 작업표시줄 하단 몇 px가 잘려 아이콘 구분이 안 된다는
/// 실사용 피드백(2026-09-03)에서 나온 값이다.
///
/// 창을 이만큼 위로 올리고 region도 같은 만큼 내리므로 **슬롯은 그대로 꽉 찬다** —
/// 한쪽만 바꾸면 슬롯 위/아래에 그만큼 빈 띠가 생긴다. `framed_rect`,
/// `chrome_region_rect`, `cutout_in_window` 셋이 같은 값을 써야 하고, 그래서
/// 상수로 뽑아 셋 다 여기서 가져간다(필 구멍이 3px 어긋나는 걸 막는 것도 이 때문).
const BOTTOM_BIAS: i32 = 3;

/// 헤더 필 모서리 반경(px). App.css의 .slot-header-bar border-radius와 같아야 한다.
/// 작은 반경이라 SetWindowRgn(1비트)과 CSS(안티앨리어싱)의 차이가 눈에 안 띈다.
/// 크게 올리면 곡선 구간 어긋남이 다시 보인다.
const PILL_RADIUS: i32 = 4;

/// Extra top rows (physical px) currently cropped away for the immersive
/// header reveal — 0 when not immersive/not hovering the top edge. This is
/// the SINGLE source of truth for that band: every SetWindowRgn call in this
/// file (initial swallow, the vmconnect stabilization loop's re-measurement,
/// and the immersive poller itself) goes through `apply_chrome_region` below,
/// which always composes the window's own chrome crop (offset/offset_x) with
/// this value. Without a single source, the vmconnect stabilization loop
/// (which re-applies its OWN region on every re-measured tick, for the life
/// of the swallow) would periodically stomp the reveal crop back to "hidden"
/// — RDP never showed this bug because its offset is always 0 and nothing
/// else touches its region after the initial swallow.
/// 자식 창에서 도려낼 사각형(left, top, right, bottom) — 창 자신의 좌표계.
type CutoutRect = (i32, i32, i32, i32);

static REVEAL_BAND: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

/// Pure geometry for the chrome clip region: given the left/top chrome offsets,
/// the current immersive reveal band, and the slot size, returns the visible
/// rect (left, top, right, bottom) in the window's own coordinates — or None
/// when there is nothing to clip (region should be cleared). Split out from the
/// Win32 call so the geometry that caused the white-border bugs is unit-testable.
fn chrome_region_rect(offset_x: i32, offset: i32, band: i32, width: i32, height: i32) -> Option<CutoutRect> {
    let top = offset + band + BOTTOM_BIAS;
    if top == 0 && offset_x == 0 {
        None
    } else {
        // 테두리가 있는 창(vmconnect)은 **아래를 1px 덜 보여준다**. 프레임의
        // non-client 아래 테두리가 region 경계와 정확히 안 겹쳐 흰 줄 1px이 남는데
        // (실측 2026-09-03: Hyper-V에서만, RDP는 offset_x=0이라 테두리가 없어 무증상),
        // 창을 1px 키워 테두리를 바깥으로 미는 방식은 vmconnect가 크기 요청을 그대로
        // 안 받아줘서 실패했다. region을 줄이는 건 우리가 100% 통제하므로 확실하다.
        // 대가는 콘텐츠 맨 아래 1px인데, 흰 줄보다 눈에 안 띈다.
        let border_trim = if offset_x > 0 { 1 } else { 0 };
        Some((offset_x, top, offset_x + width + (HORIZONTAL_BUFFER * 2),
              offset + height + BOTTOM_BIAS - border_trim))
    }
}

/// Crops rows 0..offset and cols 0..offset_x (the window's own non-removable
/// chrome, e.g. VMConnect's ribbon) PLUS the current immersive reveal band,
/// MINUS `cutout` — a hole punched through the window so the floating header
/// pill underneath shows through.
///
/// The hole is the only way a DOM element can appear ON TOP of a swallowed
/// session: the Win32 child renders physically above the WebView2 surface, so
/// z-index cannot reach it. Cutting the child instead lets the page show through.
///
/// `pill`은 **슬롯 콘텐츠 영역 기준 상대 좌표**다 — 자식 창 좌표로의 변환을
/// 여기서(= 적용 직전에, 지금 유효한 offset으로) 한다.
///
/// 예전엔 `set_header_cutout`이 저장 시점에 미리 변환해서 보관했는데, vmconnect는
/// 접속 직후 크롬을 여러 번 재측정한다(실측: (0,51)→(5,71)→(2,53)→(0,0)→(2,2)).
/// offset이 바뀌면 미리 변환해둔 좌표는 **낡은 값**이 되어 구멍이 엉뚱한 자리에
/// 뚫리고, 필이 Win32 자식에 덮여 **검게 보였다가** 프론트가 다음에 좌표를 다시
/// 보내면 복구되는 증상이 났다. 상대 좌표로 들고 있다가 여기서 변환하면 이 창은
/// 구조적으로 안 생긴다 — **다시 미리 변환해서 저장하지 말 것.**
fn apply_chrome_region(
    hwnd: HWND,
    offset_x: i32,
    offset: i32,
    width: i32,
    height: i32,
    pill: Option<CutoutRect>,
) {
    let cutout = pill.map(|p| cutout_in_window(offset_x, offset, p));
    let band = REVEAL_BAND.load(std::sync::atomic::Ordering::Relaxed);
    let base = chrome_region_rect(offset_x, offset, band, width, height);
    unsafe {
        if base.is_none() && cutout.is_none() {
            let _ = SetWindowRgn(hwnd, HRGN::default(), BOOL::from(true));
            return;
        }
        // 크롬 마스크가 필요 없는 경우(RDP: offset 0, band 0)에도 구멍을 뚫으려면
        // region 자체는 있어야 하므로 창 전체를 베이스로 삼는다. 이 사각형은
        // chrome_region_rect가 돌려주는 것과 같은 좌표계다.
        // 폴백도 BOTTOM_BIAS를 포함해야 한다 — 한쪽만 빠지면 필 구멍과 화면이
        // 그만큼 어긋난다(지금은 bias>0이라 base가 항상 Some이지만, bias를 0으로
        // 되돌리는 경우를 대비해 식을 맞춰 둔다).
        let (l, t, r, b) = base.unwrap_or((
            offset_x,
            offset + BOTTOM_BIAS,
            offset_x + width + (HORIZONTAL_BUFFER * 2),
            offset + height + BOTTOM_BIAS,
        ));
        let rgn = CreateRectRgn(l, t, r, b);
        if rgn.is_invalid() {
            return;
        }
        if let Some((cl, ct, cr, cb)) = cutout {
            // 구멍 모양은 필(App.css .slot-header-bar)과 **정확히 같아야** 한다.
            // 필은 border-radius: 0 — 그래서 여기도 단순 사각형이면 픽셀 단위로
            // 정확히 일치한다. 둥근 구멍(CreateRoundRectRgn)을 쓰지 말 것:
            // SetWindowRgn은 안티앨리어싱 없는 1비트 마스크라 곡선을 계단식으로
            // 자르는데 CSS border-radius는 안티앨리어싱된 곡선이라, 곡선 구간에서
            // 둘이 절대 안 맞고 경계에 VM 픽셀이 지저분하게 남는다.
            let d = PILL_RADIUS * 2;
            let hole = CreateRoundRectRgn(cl, ct, cr, cb, d, d);
            if !hole.is_invalid() {
                let _ = CombineRgn(rgn, rgn, hole, RGN_DIFF);
                let _ = DeleteObject(windows::Win32::Graphics::Gdi::HGDIOBJ(hole.0));
            }
        }
        // SetWindowRgn이 성공하면 region 소유권은 시스템으로 넘어가므로
        // rgn을 DeleteObject 하면 안 된다.
        let _ = SetWindowRgn(hwnd, rgn, BOOL::from(true));
    }
}

/// 필 사각형을 **슬롯 콘텐츠 영역 기준 상대 좌표**(물리 픽셀)에서 자식 창 자신의
/// 좌표계로 옮긴다.
///
/// 상대 좌표를 쓰는 이유: framed_rect가 창을 `x - HORIZONTAL_BUFFER - offset_x,
/// y - offset`에 놓으므로 콘텐츠 원점(슬롯의 x,y)은 창 좌표로 항상
/// `(HORIZONTAL_BUFFER + offset_x, offset)`이다 — 슬롯이 화면 어디로 움직이든
/// 이 값은 변하지 않는다. 절대 좌표를 받아 슬롯 위치를 빼는 방식으로 하면
/// 슬롯이 움직인 뒤 필 좌표가 도착할 때 한 프레임 어긋난 구멍이 뚫린다.
fn cutout_in_window(
    offset_x: i32,
    offset: i32,
    rel: (i32, i32, i32, i32),
) -> CutoutRect {
    let (rx, ry, rw, rh) = rel;
    let l = rx + HORIZONTAL_BUFFER + offset_x;
    let t = ry + offset + BOTTOM_BIAS;
    (l, t, l + rw, t + rh)
}

/// Window rect (x, y, w, h) that makes the swallowed content's video area exactly
/// fill the slot. offset_x/offset are the LEFT/TOP chrome (frame non-client border
/// + top ribbon). The frame's non-client border is symmetric, so the RIGHT and
/// BOTTOM each need an extra `offset_x` (= the border thickness, which equals the
/// left/top non-client inset since the ribbon has no left inset) — otherwise the
/// client is that many px short of the slot and the window's white right/bottom
/// border shows inside the region. The region (apply_chrome_region) stays slot-
/// sized and clips any excess, so erring slightly large here is safe.
/// For RDP/Horizon offset_x == offset == 0, so this is a no-op (slot rect).
fn framed_rect(x: i32, y: i32, w: i32, h: i32, offset_x: i32, offset: i32) -> CutoutRect {
    (
        x - HORIZONTAL_BUFFER - offset_x,
        y - offset - BOTTOM_BIAS,
        w + (HORIZONTAL_BUFFER * 2) + offset_x * 2,
        h + offset + offset_x + BOTTOM_BIAS,
    )
}

fn get_offset(class_name: &str) -> i32 {
    let lower_class = class_name.to_lowercase();
    if lower_class.contains("vmconnect") {
        HYPERV_OFFSET
    } else if lower_class.contains("blast") ||
              lower_class.contains("vmui") || 
              lower_class.contains("tclient") ||
              lower_class.contains("vmware-view") ||
              lower_class.contains("omnissa") {
        HORIZON_OFFSET
    } else if lower_class.contains("tscshellcontainerclass") {
        0 // RDP is pixel perfect with 0 offset
    } else {
        DEFAULT_OFFSET
    }
}

struct EnumParam {
    target_pid: u32,
    found_hwnd: HWND,
    /// hwnds already owned by an existing swallow (any slot). Must be excluded
    /// from both passes — see find_main_window for why.
    excluded: Vec<isize>,
    /// Lowercased window-title fragment (the VM name for Hyper-V console
    /// connects, None otherwise). When set, the candidate is chosen by TITLE,
    /// not class or PID: vmconnect is single-instance-per-VM (the spawned PID
    /// can hand off and exit, making pid-scoping useless) and — confirmed by
    /// live probe 2026-07-21 — its console frame is a generic
    /// "WindowsForms10.Window.8.app.*" window, NOT in the class list below and
    /// NOT containing "vmconnect". So neither the class match nor the pid
    /// fallback can find it; only the title can. The real console title is
    /// "<host>의 <VM> - 가상 컴퓨터 연결" (localized), and a small transient
    /// "<VM>에 연결" progress window (477x224) coexists with the full console
    /// frame (650x508+). We therefore keep the LARGEST-area title match
    /// (`best_area`) — locale-independent, and reliably the console over the
    /// progress popup.
    title_needle: Option<String>,
    /// For the title_needle path: area (px²) of the current best (largest)
    /// title-matching window. 0 = none yet.
    best_area: i64,
}

/// Pure core of the title-driven candidate selection (unit-testable without a
/// live desktop). Given a window's title, its area, and the current best area,
/// returns Some(new_best_area) if this window should REPLACE the current best
/// (title contains the needle AND is strictly larger), else None. The callback
/// keeps the largest match so the full vmconnect console frame beats the small
/// transient "connecting" popup — see EnumParam::title_needle. `needle` must be
/// pre-lowercased; `title` is lowercased here.
fn title_match_better(title: &str, needle: &str, area: i64, best_area: i64) -> Option<i64> {
    if title.to_lowercase().contains(needle) && area > best_area {
        Some(area)
    } else {
        None
    }
}

struct ChildParam {
    found: HWND
}

/// Finds the target process's main/session window. `pid` here is the PID
/// Command::spawn returned, which for vmconnect.exe is NOT reliable — vmconnect
/// is single-instance-per-VM and hands off to an already-running elevated
/// instance, so the spawned PID can own no window at all. That's what the
/// target_pid=0 fallback below exists for (search all windows by class instead
/// of PID) — but with no PID filter, it will just as happily hand back a
/// DIFFERENT slot's already-swallowed window if the class matches (e.g. a live
/// TscShellContainerClass from an RDP slot), stealing it out from under that
/// slot. `excluded` is every hwnd already tracked in SWALLOW_STATE (any slot)
/// at call time — both passes skip them, so a fresh search can only ever
/// re-find windows nobody has already claimed.
pub fn find_main_window(pid: u32, title_needle: Option<&str>) -> Option<HWND> {
    let excluded: Vec<isize> = excluded_hwnds();
    let needle = title_needle.map(|s| s.to_lowercase());

    let mut param = EnumParam {
        target_pid: pid,
        found_hwnd: HWND(std::ptr::null_mut()),
        excluded: excluded.clone(),
        title_needle: needle.clone(),
        best_area: 0,
    };
    unsafe {
        let _ = EnumWindows(Some(enum_windows_callback), LPARAM(&mut param as *mut EnumParam as isize));
    }

    if !param.found_hwnd.is_invalid() {
        return Some(param.found_hwnd);
    }

    // 2차 패스(pid 무시, 시스템 전체 스캔)는 **제목 needle이 있을 때만** 돈다.
    //
    // 이게 존재하는 이유는 오직 Hyper-V 콘솔 핸드오프다: vmconnect는 VM당 단일
    // 인스턴스라 우리가 spawn한 PID가 기존 인스턴스에 넘기고 죽을 수 있어서, PID로는
    // 절대 못 찾는다. 그때 VM 이름이라는 **구체적인 판별자**로 찾는 건 안전하다.
    //
    // 반대로 needle이 없는 RDP/Horizon에서 이 패스를 돌리면 클래스만 보고 고르는데,
    // `TscShellContainerClass`는 **사용자가 HyperDesk 밖에서 직접 띄운 원격데스크톱
    // 창도 똑같이 가진다**. 그래서 우리 mstsc가 아직 안 떴을 뿐인 상황에서 남의
    // 세션을 슬롯으로 빨아들이고, 나중에 unswallow가 WM_CLOSE를 보내 **그 세션을
    // 끊어버린다**(2026-08-26 사용자 보고: "로컬에 열어둔 mstsc가 끊긴다").
    // 우리 것과 남의 것을 구분할 방법이 없으므로 추측하지 않는다 — 맞는 PID의 창이
    // 뜰 때까지 hunt 루프가 계속 폴링하게 두는 게 옳다.
    // **needle이 없을 때 이 패스를 다시 켜지 말 것.**
    let needle = needle?;

    let mut fallback_param = EnumParam {
        target_pid: 0,
        found_hwnd: HWND(std::ptr::null_mut()),
        excluded,
        title_needle: Some(needle),
        best_area: 0,
    };
    unsafe {
        let _ = EnumWindows(Some(enum_windows_callback), LPARAM(&mut fallback_param as *mut EnumParam as isize));
    }

    if !fallback_param.found_hwnd.is_invalid() {
        Some(fallback_param.found_hwnd)
    } else {
        None
    }
}

pub fn find_webview_container(parent: HWND) -> HWND {
    let mut param = ChildParam { found: parent };
    
    unsafe {
        let _ = EnumChildWindows(parent, Some(enum_child_callback), LPARAM(&mut param as *mut ChildParam as isize));
    }
    param.found
}

extern "system" fn enum_child_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let param = unsafe { &mut *(lparam.0 as *mut ChildParam) };
    let mut class_name = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, &mut class_name) };
    if len > 0 {
        let class_str = String::from_utf16_lossy(&class_name[..len as usize]);
        // Support for multiple Chromium/WebView2 container classes
        if class_str.contains("Chrome_WidgetWin") || 
           class_str.contains("WebView2WebViewController") ||
           class_str.contains("EmbeddedBrowserControl") ||
           class_str.contains("Internet Explorer_Server") {
            param.found = hwnd;
            return BOOL::from(false);
        }
    }
    BOOL::from(true)
}

/// A swallowed frame (vmconnect, mstsc) wraps the real display surface in its own
/// chrome (title/menu/toolbar/connection-bar) that can't be reliably stripped. So we
/// instead find the child window that holds the actual video and clip/position around
/// it. `find_child_rect_by_class` returns the first descendant whose class contains
/// `needle` (lowercased), in the frame's CLIENT coordinates, or None. We do NOT
/// reparent the child — SetParent of these WPF/ActiveX children crashes wry.
struct VideoRectParam<'a> {
    frame: HWND,
    needle: &'a str,
    rect: Option<RECT>,
}

fn find_child_rect_by_class(frame: HWND, needle: &str) -> Option<RECT> {
    let mut param = VideoRectParam { frame, needle, rect: None };
    unsafe {
        let _ = EnumChildWindows(frame, Some(enum_video_rect_callback), LPARAM(&mut param as *mut VideoRectParam as isize));
    }
    param.rect
}

/// vmconnect's VM-video child is `HwndWrapper[vmconnect.exe;...]`.
fn find_vmconnect_video_rect(frame: HWND) -> Option<RECT> {
    find_child_rect_by_class(frame, "hwndwrapper[vmconnect")
}

/// The frame's own NON-CLIENT border thickness (left, top) in physical px — the
/// gap between its window rect and its client rect. WinForms re-adds a ~2-3px
/// border even after WS_THICKFRAME is stripped; in an Enhanced-session vmconnect
/// that border is the white edge around the VM (the content child fills the
/// CLIENT area, so a child-relative inset measures 0 and misses it). Measured
/// deterministically from the two rects, so it self-corrects across the
/// Basic→Enhanced tree swap with no dependence on child-layout timing.
fn frame_nc_border(hwnd: HWND) -> (i32, i32) {
    unsafe {
        let mut wr = RECT::default();
        if GetWindowRect(hwnd, &mut wr).is_err() { return (0, 0); }
        let mut origin = POINT { x: 0, y: 0 };
        if ClientToScreen(hwnd, &mut origin).as_bool() {
            ((origin.x - wr.left).clamp(0, 20), (origin.y - wr.top).clamp(0, 20))
        } else {
            (0, 0)
        }
    }
}

struct OwnedWindowParam<'a> {
    pid: u32,
    needle: &'a str,
    found: Option<HWND>,
}

extern "system" fn enum_owned_window_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let param = unsafe { &mut *(lparam.0 as *mut OwnedWindowParam) };
    let mut pid = 0u32;
    unsafe { let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid)); }
    if pid != param.pid {
        return BOOL::from(true);
    }
    let mut buf = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    if len > 0 {
        let class = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
        if class.contains(param.needle) {
            param.found = Some(hwnd);
            return BOOL::from(false);
        }
    }
    BOOL::from(true)
}

/// Hyper-V's "connect bar" (the pinnable floating toolbar vmconnect shows over the VM
/// surface — present in both Basic and Enhanced Session Mode) is its own TOP-LEVEL
/// window owned by vmconnect.exe, class `BBarWindowClass`. It is NOT a descendant of
/// the frame we swallow, so EnumChildWindows (used for the video-rect chrome mask)
/// never sees it and no clip region can hide it. Find it among vmconnect's other
/// top-level windows by pid + class and hide it directly instead.
fn find_vmconnect_bbar(pid: u32) -> Option<HWND> {
    let mut param = OwnedWindowParam { pid, needle: "bbar", found: None };
    unsafe {
        let _ = EnumWindows(Some(enum_owned_window_callback), LPARAM(&mut param as *mut OwnedWindowParam as isize));
    }
    param.found
}

/// Horizon이 화면 상단에 띄우는 **자체 연결 바**를 숨긴다(핀 / Ctrl+Alt+Del /
/// USB 디바이스 / 전체 화면 종료 …).
///
/// 이 바는 우리 헤더 필과 **정확히 같은 자리**(상단 중앙)에 떠서 필을 덮는다 —
/// 필을 잡을 수도 없고 Alt+1~4도 그쪽으로 샌다. vmconnect의 BBar와 같은 부류다.
///
/// **클래스로는 못 고른다.** 실측(2026-09-03): 데스크톱 프레임·런처·연결 바가 전부
/// `HwndWrapper[Horizon.Client.UI;;<GUID>]`로 GUID만 다르다. 그래서 기하로 고른다 —
/// 프로세스 소유 최상위 창 중 **화면 최상단에 붙은 얇고 넓은 것**
/// (실측값: `rect=(2511,0 737x41)`). 우리가 swallow한 프레임(`skip`)은 당연히 제외.
/// 진단 로그 예산(전체 실행 통틀어 N줄). 매 폴 찍으면 로그가 묻힌다.
static DIAG_LEFT: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(40);

pub fn hide_horizon_bars(pid: u32, skip: HWND) {
    struct P { pid: u32, skip: isize, found: Vec<isize> }
    extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let p = unsafe { &mut *(lparam.0 as *mut P) };
        if hwnd.0 as isize == p.skip { return BOOL::from(true); }
        let mut q = 0u32;
        unsafe { let _ = GetWindowThreadProcessId(hwnd, Some(&mut q)); }
        if q != p.pid { return BOOL::from(true); }
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() { return BOOL::from(true); }
        let mut r = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut r) }.is_err() { return BOOL::from(true); }
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        // 상단에 붙은(위 8px 이내) 얇고(<=60px) 넓은(>=200px) 창 = 연결 바.
        // 데스크톱 프레임은 이미 skip이고, 런처(1440x789)는 높이에서 걸러진다.
        // 후보를 전부 남긴다 — 필터가 왜 안 걸리는지는 "무엇을 봤는가" 없이는
        // 알 수 없다(추측으로 조건만 만지다 여러 번 헛짚었다). 스팸을 막으려고
        // 프로세스당 처음 몇 번만 찍는다.
        if DIAG_LEFT.fetch_sub(1, std::sync::atomic::Ordering::Relaxed) > 0 {
            dlog!("[horizon] candidate {:?} rect=({},{} {}x{}) match={}",
                hwnd.0, r.left, r.top, w, h, r.top <= 8 && h <= 60 && w >= 200);
        }
        if r.top <= 8 && h <= 60 && w >= 200 {
            p.found.push(hwnd.0 as isize);
        }
        BOOL::from(true)
    }
    let mut p = P { pid, skip: skip.0 as isize, found: Vec::new() };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut p as *mut P as isize));
        for raw in p.found {
            let h = HWND(raw as *mut _);
            dlog!("[horizon] hiding connect bar {:?}", raw);
            let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(
                h, windows::Win32::UI::WindowsAndMessaging::SW_HIDE);
        }
    }
}

pub fn hide_vmconnect_bbar(pid: u32) {
    if let Some(bar) = find_vmconnect_bbar(pid) {
        unsafe {
            if IsWindowVisible(bar).as_bool() {
                let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(bar, windows::Win32::UI::WindowsAndMessaging::SW_HIDE);
            }
        }
    }
}

extern "system" fn enum_video_rect_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let param = unsafe { &mut *(lparam.0 as *mut VideoRectParam) };
    let mut buf = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    if len > 0 {
        let class = String::from_utf16_lossy(&buf[..len as usize]);
        if class.to_lowercase().contains(param.needle) {
            unsafe {
                let mut r = RECT::default();
                if GetWindowRect(hwnd, &mut r).is_ok() {
                    // GetWindowRect is screen-space; convert to the frame's client space.
                    let mut tl = POINT { x: r.left, y: r.top };
                    let mut br = POINT { x: r.right, y: r.bottom };
                    let _ = ScreenToClient(param.frame, &mut tl);
                    let _ = ScreenToClient(param.frame, &mut br);
                    param.rect = Some(RECT { left: tl.x, top: tl.y, right: br.x, bottom: br.y });
                }
            }
            return BOOL::from(false);
        }
    }
    BOOL::from(true)
}

extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let param = unsafe { &mut *(lparam.0 as *mut EnumParam) };
    if param.excluded.contains(&(hwnd.0 as isize)) { return BOOL::from(true); }
    let mut pid = 0;
    unsafe {
        let thread_id = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if thread_id == 0 { return BOOL::from(true); }

        if (param.target_pid == 0 || pid == param.target_pid) && IsWindowVisible(hwnd).as_bool() {
             // ── Title-driven path (Hyper-V console) ──────────────────────────
             // When a VM name is given, the title is the ONLY reliable
             // discriminator (see EnumParam::title_needle). Class and pid can't
             // find vmconnect's WindowsForms console frame. We DON'T stop at the
             // first match: we keep the largest-area title match so the full
             // console frame wins over the small transient "connecting" popup,
             // and so a handoff-owned window in pass 2 (target_pid==0) is found.
             if let Some(needle) = &param.title_needle {
                 let mut tbuf = [0u16; 512];
                 let tlen = GetWindowTextW(hwnd, &mut tbuf);
                 let title = String::from_utf16_lossy(&tbuf[..tlen as usize]).to_lowercase();
                 let mut r = RECT::default();
                 if GetWindowRect(hwnd, &mut r).is_ok() {
                     let area = (r.right - r.left) as i64 * (r.bottom - r.top) as i64;
                     // title already lowercased above; pass needle as-is (lowercased in find_main_window)
                     if let Some(new_best) = title_match_better(&title, needle.as_str(), area, param.best_area) {
                         param.best_area = new_best;
                         param.found_hwnd = hwnd;
                     }
                 }
                 return BOOL::from(true); // scan every window; pick the biggest
             }

             // ── Class-driven path (RDP / Horizon, no title needle) ───────────
             let mut class_name = [0u16; 256];
             let len = GetClassNameW(hwnd, &mut class_name);
             let class_str = if len > 0 { String::from_utf16_lossy(&class_name[..len as usize]) } else { String::new() };
             if class_str.contains("TscShellContainerClass") ||
                class_str.contains("VMConnect") ||
                class_str.contains("UIWindow") ||
                class_str.contains("VMWindow") ||
                class_str.contains("VMware-view-MainWindow") ||
                class_str.contains("BlastWindowClass") ||
                class_str.contains("VMUIFrame") ||
                class_str.contains("TClient") ||
                class_str.contains("Omnissa") {
                 param.found_hwnd = hwnd;
                 return BOOL::from(false);
             }
             // "#32770" is the generic Windows dialog-box class — mstsc's "publisher
             // could not be verified" security prompt is one of these.
             // "TSC_POPUP_PARENT_WNDCLASS" is mstsc's dedicated OWNER window for that
             // same dialog (confirmed via live dlog: EnumWindows returns both, in
             // either order, for the same pid, before TscShellContainerClass exists —
             // the dialog itself has no content of its own to stretch, so grabbing
             // its owner produced the empty-frame-with-content-pinned-top-left look).
             // Neither is the session window; the blind any-visible-window-of-this-
             // pid fallback below must skip both and keep polling, letting the
             // warning stay a normal floating window until the user answers it.
             if param.target_pid != 0 && param.found_hwnd.is_invalid()
                && class_str != "#32770" && class_str != "TSC_POPUP_PARENT_WNDCLASS" {
                 param.found_hwnd = hwnd;
             }
        }
    }
    BOOL::from(true)
}

/// DEV-ONLY: dump the descendant window tree (class + rect + visibility) of a
/// swallowed frame to stderr. vmconnect wraps the real VM video in its own frame
/// with a title/menu/toolbar; to swallow just the video cleanly we need to know
/// which child is the display surface. Run `npm run tauri dev`, connect a VM, and
/// the printed tree identifies the target class (no blind guessing in release).
#[cfg(debug_assertions)]
extern "system" fn dump_tree_callback(hwnd: HWND, _lparam: LPARAM) -> BOOL {
    unsafe {
        let mut buf = [0u16; 256];
        let len = GetClassNameW(hwnd, &mut buf);
        let class = String::from_utf16_lossy(&buf[..len as usize]);
        let mut r = RECT::default();
        let _ = GetWindowRect(hwnd, &mut r);
        dlog!(
            "[swallow-tree] hwnd={:?} class='{}' rect=({},{} {}x{}) visible={}",
            hwnd.0, class, r.left, r.top, r.right - r.left, r.bottom - r.top,
            IsWindowVisible(hwnd).as_bool()
        );
    }
    BOOL::from(true)
}

#[cfg(debug_assertions)]
fn dump_window_tree(frame: HWND) {
    dlog!("[swallow-tree] ==== descendants of frame {:?} ====", frame.0);
    unsafe {
        let _ = EnumChildWindows(frame, Some(dump_tree_callback), LPARAM(0));
    }
}

/// DEV-ONLY: dump_window_tree only sees true children (EnumChildWindows). vmconnect's
/// connect-bar (BBarWindowClass) is a separate TOP-LEVEL window merely owned by the
/// same process, so it needs a pid-scoped EnumWindows pass to show up at all — this is
/// how it was confirmed to be invisible to the child-tree dump in the first place.
#[cfg(debug_assertions)]
fn dump_owned_top_level_windows(pid: u32, skip: HWND) {
    dlog!("[swallow-tree] ==== other top-level windows owned by pid={} ====", pid);
    struct DumpParam { pid: u32, skip: HWND }
    extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let param = unsafe { &*(lparam.0 as *const DumpParam) };
        if hwnd.0 == param.skip.0 { return BOOL::from(true); }
        let mut pid = 0u32;
        unsafe { let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid)); }
        if pid != param.pid { return BOOL::from(true); }
        let mut buf = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, &mut buf) };
        let class = String::from_utf16_lossy(&buf[..len as usize]);
        let mut r = RECT::default();
        let _ = unsafe { GetWindowRect(hwnd, &mut r) };
        dlog!(
            "[swallow-tree] hwnd={:?} class='{}' rect=({},{} {}x{}) visible={}",
            hwnd.0, class, r.left, r.top, r.right - r.left, r.bottom - r.top,
            unsafe { IsWindowVisible(hwnd).as_bool() }
        );
        BOOL::from(true)
    }
    let param = DumpParam { pid, skip };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&param as *const DumpParam as isize));
    }
}

pub fn swallow(slot_id: &str, target_pid: u32, parent_hwnd: HWND, app_handle: AppHandle, bounds: SlotBounds, expected_title: Option<String>) -> Result<(), String> {
    let s_id = slot_id.to_string();
    // Captured now, checked every poll below — a later swallow()/unswallow() call
    // for this same slot bumps the generation and makes this hunt a no-op.
    let my_gen = bump_generation(slot_id);
    let _parent_h = SendHWND(parent_hwnd);
    let actual_parent = SendHWND(find_webview_container(parent_hwnd));
    let app = app_handle.clone();

    std::thread::spawn(move || {
        // Chain of windows already swallowed into this slot (login → picker →
        // desktop). Never re-swallow one — that's what prevents oscillation.
        let mut chain: Vec<isize> = Vec::new();
        let mut current: Option<SendHWND> = None;
        let mut session_found = false;
        let mut is_horizon = false;

        let start = std::time::Instant::now();
        // RDP/vmconnect windows appear fast — 20s is generous. Horizon shows a
        // LOGIN window first and the desktop window only exists after the user
        // finishes typing credentials/2FA, so once a Horizon launcher is seen
        // the hunt is extended (the user is typing, not the machine working).
        let mut deadline = start + std::time::Duration::from_secs(20);
        #[cfg(debug_assertions)]
        let mut last_dump = std::time::Instant::now() - std::time::Duration::from_secs(60);

        let read_class = |h: HWND| -> String {
            let mut buf = [0u16; 256];
            let len = unsafe { GetClassNameW(h, &mut buf) };
            String::from_utf16_lossy(&buf[..len as usize])
        };

        while std::time::Instant::now() < deadline {
            // Superseded by a newer swallow() (reconnect) or an unswallow()
            // (cancel/disconnect) for this same slot — stop immediately, no
            // events, no state writes. Silent by design: whichever call bumped
            // the generation is responsible for the slot's visible state now.
            if current_generation(&s_id) != my_gen {
                return;
            }

            // Preferred: a window with a KNOWN session class (pid-scoped first,
            // then the class-list fallback inside find_main_window).
            let mut candidate: Option<HWND> = find_main_window(target_pid, expected_title.as_deref())
                .filter(|h| !chain.contains(&(h.0 as isize)));

            // After the first stage, only KNOWN session classes may come from the
            // pid-scoped search — its "any visible window of the pid" fallback
            // would otherwise hand us vmconnect's floating toolbar (BBar) or an
            // IME window as a bogus next stage.
            if let Some(h) = candidate {
                // This class gate exists for the PID-scoped BLIND fallback (RDP/
                // Horizon, no title needle) — that fallback can hand back a bogus
                // next stage (vmconnect's floating BBar, an IME window) since it
                // doesn't look at class at all. The title-driven path (Hyper-V
                // console) never goes through that blind fallback — find_main_window
                // only returns a title+largest-area match there — so this gate must
                // not apply to it. Without this exception, once a wrong vmconnect
                // dialog (e.g. its display-settings picker, also a generic
                // WindowsForms class) got chained first, the REAL console frame
                // (also WindowsForms, not Blast/VMUI/TClient/TscShellContainerClass)
                // could never replace it — the hunt got stuck on the wrong window
                // until the deadline hit and locked it in as "the session".
                if !chain.is_empty() && expected_title.is_none() {
                    let c = read_class(h);
                    let is_sess = c.contains("Blast") || c.contains("VMUI") ||
                                  c.contains("TClient") || c.contains("TscShellContainerClass");
                    if !is_sess { candidate = None; }
                }
            }

            // Horizon: the next window in the chain is often a NEW top-level
            // window (same WPF class family, sometimes even another process)
            // that the pid-scoped search never sees. Hunt for it by heuristic.
            if candidate.is_none() && is_horizon {
                // Same exclusion as find_main_window: never hand back a window
                // another slot already owns or has claimed, not just ones this
                // slot's own chain already tried.
                let mut exclude = chain.clone();
                exclude.extend(excluded_hwnds());
                candidate = find_horizon_session_window(&exclude);
            }

            if let Some(h) = candidate {
                let class_str = read_class(h);
                let is_session = class_str.contains("Blast") ||
                               class_str.contains("VMUI") ||
                               class_str.contains("TClient") ||
                               class_str.contains("TscShellContainerClass");
                let lower = class_str.to_lowercase();
                if lower.contains("horizon") || lower.contains("omnissa") || lower.contains("vmware") {
                    if !is_horizon {
                        is_horizon = true;
                        deadline = start + std::time::Duration::from_secs(180);
                    }
                }

                // Swallow this stage of the chain; hide the previous one if it
                // is still alive (login window lingering behind the picker).
                let h_wrap = SendHWND(h);
                if let Some(prev) = current {
                    if prev.0 .0 != h.0 {
                        unsafe {
                            let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(prev.0, windows::Win32::UI::WindowsAndMessaging::SW_HIDE);
                        }
                        // 한 번 숨기는 걸로 끝내지 않는다 — 다시 나타나면 루프가 도로 숨긴다.
                        superseded().lock().unwrap_or_else(|e| e.into_inner())
                            .entry(s_id.clone()).or_default().push(prev.0 .0 as isize);
                    }
                }
                chain.push(h.0 as isize);
                // Claim BEFORE perform_swallow runs, not after: perform_swallow
                // only writes SWALLOW_STATE once it's done, so without this claim
                // another slot's concurrent hunt (same poll tick, before either
                // commits) could pick the identical candidate and both race to
                // reparent it. Released unconditionally once perform_swallow
                // returns — from then on SWALLOW_STATE itself is authoritative on
                // success, and a failed candidate is already excluded via `chain`.
                lock_claimed().insert(h.0 as isize);
                // `current` (and therefore the eventual swallow-success emission
                // below) must only be set on a VERIFIED reparent — perform_swallow
                // now returns Err if GetParent doesn't confirm the new parent
                // (e.g. UIPI blocked it). chain already recorded this hwnd, so a
                // failed candidate won't be retried; the hunt just keeps polling
                // for another one until the deadline.
                // perform_swallow currently always returns Ok — its GetParent-based
                // failure detection was reverted (false-positived on real mstsc/
                // vmconnect windows, see the note at its SetParent call). The
                // Result plumbing and match below are kept because the generation/
                // claim-set logic around it (V5/V6 fixes) still needs the call
                // site structure; Err is simply unreachable for now.
                let swallow_result = perform_swallow(&s_id, h_wrap, actual_parent, app.clone(), bounds);
                lock_claimed().remove(&(h.0 as isize));

                // A cancel/reconnect can bump the generation DURING perform_swallow
                // — the top-of-loop check passed a moment too early. If so this
                // hunt is stale: undo the embed rather than leave a window the user
                // cancelled sitting in the slot (and never emit swallow-success for
                // it). Remove the slot entry only if it still points at OUR window;
                // a newer hunt may already own the slot and must not be disturbed.
                if current_generation(&s_id) != my_gen {
                    let our_info = {
                        let mut st = lock_state();
                        if matches!(st.get(&s_id), Some(info) if info.child_hwnd == h.0 as isize) {
                            st.remove(&s_id)
                        } else {
                            None
                        }
                    };
                    match our_info {
                        Some(info) => restore_and_close(&info),
                        // Slot was overwritten by a newer hunt: if we still managed
                        // to reparent a window, close it so it isn't left orphaned
                        // inside the container behind the newer session.
                        None if swallow_result.is_ok() => unsafe {
                            if IsWindow(h).as_bool() {
                                let _ = SetParent(h, HWND(std::ptr::null_mut()));
                                let _ = PostMessageW(h, WM_CLOSE, WPARAM(0), LPARAM(0));
                            }
                        },
                        None => {}
                    }
                    return;
                }

                match swallow_result {
                    Ok(()) => {
                        current = Some(h_wrap);
                        if is_session {
                            session_found = true;
                            break;
                        }
                        // Launcher/intermediate window swallowed — tell the frontend
                        // so it starts bounds-syncing, then keep hunting for the session.
                        let _ = app.emit("swallow-progress", s_id.clone());
                    }
                    #[cfg(debug_assertions)]
                    Err(e) => dlog!("[swallow] perform_swallow failed for hwnd={:?}: {}", h.0, e),
                    #[cfg(not(debug_assertions))]
                    Err(_) => {}
                }
            }

            // Dev: while hunting a Horizon session, periodically dump every
            // visible top-level window so a missed desktop-window class is
            // identifiable from the log instead of guessed.
            #[cfg(debug_assertions)]
            if is_horizon && last_dump.elapsed().as_secs() >= 5 {
                last_dump = std::time::Instant::now();
                dump_all_visible_windows();
            }

            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        if current.is_some() {
            #[cfg(debug_assertions)]
            if !session_found {
                dlog!("[swallow] deadline hit — keeping last chain window as the session");
            }
            let _ = session_found; // silence unused warning in release
            let _ = app.emit("swallow-success", s_id.clone());
        } else {
            let _ = app.emit("swallow-failure", s_id.clone());
        }
    });

    Ok(())
}

/// Horizon window-chain heuristic: the biggest visible top-level window of the
/// Horizon/Omnissa family that we have NOT already swallowed. Size floor keeps
/// toasts/tooltips out; "biggest wins" makes login→picker→desktop converge on
/// the desktop view. ponytail: class-substring heuristic — replace with the
/// exact desktop class once a live log (dump_all_visible_windows) confirms it.
fn find_horizon_session_window(exclude: &[isize]) -> Option<HWND> {
    struct P<'a> {
        exclude: &'a [isize],
        best: Option<(HWND, i32)>,
    }
    extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let p = unsafe { &mut *(lparam.0 as *mut P) };
        if p.exclude.contains(&(hwnd.0 as isize)) { return BOOL::from(true); }
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() { return BOOL::from(true); }
            let mut buf = [0u16; 256];
            let len = GetClassNameW(hwnd, &mut buf);
            if len <= 0 { return BOOL::from(true); }
            let class = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
            if !(class.contains("horizon") || class.contains("omnissa") ||
                 class.contains("blast") || class.contains("vmui") || class.contains("vmware")) {
                return BOOL::from(true);
            }
            let mut r = RECT::default();
            if GetWindowRect(hwnd, &mut r).is_err() { return BOOL::from(true); }
            let (w, h) = (r.right - r.left, r.bottom - r.top);
            if w < 500 || h < 400 { return BOOL::from(true); }
            let area = w * h;
            if p.best.map(|(_, a)| area > a).unwrap_or(true) {
                p.best = Some((hwnd, area));
            }
        }
        BOOL::from(true)
    }
    let mut p = P { exclude, best: None };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut p as *mut P as isize));
    }
    p.best.map(|(h, _)| h)
}

/// Recursively finds the first descendant of `root` whose class name contains
/// `needle` (EnumChildWindows visits grandchildren too, not just direct
/// children — same primitive dump_window_tree uses).
fn find_descendant_by_class(root: HWND, needle: &str) -> Option<HWND> {
    struct P<'a> { needle: &'a str, found: Option<HWND> }
    extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let p = unsafe { &mut *(lparam.0 as *mut P) };
        let mut buf = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, &mut buf) };
        let class = String::from_utf16_lossy(&buf[..len.max(0) as usize]);
        if class.contains(p.needle) {
            p.found = Some(hwnd);
            return BOOL::from(false); // stop enumerating
        }
        BOOL::from(true)
    }
    let mut p = P { needle, found: None };
    unsafe {
        let _ = EnumChildWindows(root, Some(cb), LPARAM(&mut p as *mut P as isize));
    }
    p.found
}

/// MANUAL LIVE PROBE, not a real test — run with a Horizon desktop session
/// already open (not swallowed by HyperDesk):
///   cargo test horizon_force_embed_experiment -- --ignored --nocapture
/// Logs every tick to %TEMP%\hyperdesk-swallow.log (dlog!). Tests option (b)
/// from the horizon-swallow-blocked-by-mks memory: instead of SetParent-ing
/// MKSEmbedded (Horizon's actual render surface, several levels below the
/// frame the hunt loop swallows), force it back to a target rect on every
/// poll and see whether Horizon (a) leaves it alone, (b) fights back but
/// loses the race, or (c) always wins — only (a)/(b) are viable.
#[cfg(test)]
#[test]
#[ignore]
fn horizon_force_embed_experiment() {
    let frame = find_horizon_session_window(&[])
        .expect("no Horizon session window found — open one first");
    let surface = find_descendant_by_class(frame, "MKSEmbedded")
        .expect("MKSEmbedded not found under the frame — class name may have changed, check dump_window_tree");
    dlog!("[mks-experiment] frame={:?} surface={:?}", frame.0, surface.0);

    // Arbitrary target in SCREEN coords. SetWindowPos on a WS_CHILD window
    // takes PARENT-relative coords, not screen coords — the ScreenToClient
    // conversion below is the thing the C# draft skipped (its PointToScreen
    // math only survives if the surface's immediate parent happens to sit at
    // screen origin 0,0).
    let target_screen = RECT { left: 100, top: 100, right: 900, bottom: 700 };
    let (tw, th) = (target_screen.right - target_screen.left, target_screen.bottom - target_screen.top);

    for tick in 0..100 { // ~10s at 100ms
        unsafe {
            if !IsWindow(surface).as_bool() {
                dlog!("[mks-experiment] surface destroyed at tick {}", tick);
                break;
            }
            let mut before = RECT::default();
            let _ = GetWindowRect(surface, &mut before);

            let mismatched = before.left != target_screen.left || before.top != target_screen.top
                || (before.right - before.left) != tw || (before.bottom - before.top) != th;

            if mismatched {
                let parent = windows::Win32::UI::WindowsAndMessaging::GetParent(surface)
                    .unwrap_or(HWND(std::ptr::null_mut()));
                let mut tl = POINT { x: target_screen.left, y: target_screen.top };
                let _ = ScreenToClient(parent, &mut tl);
                let _ = SetWindowPos(surface, HWND(std::ptr::null_mut()), tl.x, tl.y, tw, th,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOZORDER);
            }

            let mut after = RECT::default();
            let _ = GetWindowRect(surface, &mut after);
            dlog!("[mks-experiment] tick={} before=({},{} {}x{}) forced={} after=({},{} {}x{})",
                tick, before.left, before.top, before.right - before.left, before.bottom - before.top,
                mismatched,
                after.left, after.top, after.right - after.left, after.bottom - after.top);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

/// DEV-ONLY: dump every visible top-level window (class + rect + pid) with a
/// non-trivial size. Used while hunting a Horizon session so an unmatched
/// desktop-window class shows up in %TEMP%\hyperdesk-swallow.log.
#[cfg(debug_assertions)]
fn dump_all_visible_windows() {
    dlog!("[horizon-scan] ==== visible top-level windows ====");
    extern "system" fn cb(hwnd: HWND, _lparam: LPARAM) -> BOOL {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() { return BOOL::from(true); }
            let mut r = RECT::default();
            if GetWindowRect(hwnd, &mut r).is_err() { return BOOL::from(true); }
            let (w, h) = (r.right - r.left, r.bottom - r.top);
            if w < 300 || h < 200 { return BOOL::from(true); }
            let mut buf = [0u16; 256];
            let len = GetClassNameW(hwnd, &mut buf);
            let class = String::from_utf16_lossy(&buf[..len.max(0) as usize]);
            let mut pid = 0u32;
            let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
            dlog!("[horizon-scan] hwnd={:?} pid={} class='{}' rect=({},{} {}x{})",
                hwnd.0, pid, class, r.left, r.top, w, h);
        }
        BOOL::from(true)
    }
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(0));
    }
}

fn perform_swallow(slot_id: &str, child_h: SendHWND, actual_parent_h: SendHWND, app_handle: AppHandle, bounds: SlotBounds) -> Result<(), String> {
    let SlotBounds { x, y, width, height } = bounds;
    let child_hwnd = child_h.0;
    let actual_parent = actual_parent_h.0;

    // 최초 스왈로우 시점의 슬롯 좌표. 이후 [bounds] 로그와 비교하면 "처음부터
    // 넓게 잡혔는지" vs "처음엔 맞았는데 이후 갱신이 안 왔는지"가 바로 갈린다.
    dlog!("[bounds] slot={} INITIAL=({},{} {}x{})", slot_id, x, y, width, height);

    #[cfg(debug_assertions)]
    let read_class = |h: HWND| -> String {
        let mut buf = [0u16; 256];
        let len = unsafe { GetClassNameW(h, &mut buf) };
        String::from_utf16_lossy(&buf[..len as usize])
    };

    // Dev: dump the frame class + child tree of whatever we swallow.
    #[cfg(debug_assertions)]
    {
        dlog!("[swallow-tree] FRAME class='{}'", read_class(child_hwnd));
        dump_window_tree(child_hwnd);
    }

    // NOTE: do NOT reparent the bare HwndWrapper[vmconnect.exe] video child into the
    // WebView2 container — SetParent of that WPF/WinForms child crashes wry with a null
    // pointer deref (webview2/mod.rs). vmconnect is swallowed as the whole frame, and
    // its toolbar/ribbon is hidden by the HYPERV_OFFSET region mask instead.

    let mut class_name_buf = [0u16; 256];
    let class_len = unsafe { GetClassNameW(child_hwnd, &mut class_name_buf) };
    let class_str = String::from_utf16_lossy(&class_name_buf[..class_len as usize]);
    let mut offset = get_offset(&class_str);

    // vmconnect detection is by the VM-video CHILD, not the frame's class name.
    // The frame is a generic WinForms window (class 'WindowsForms10.Window...'),
    // so matching on "vmconnect" in the frame class missed every real session —
    // the chrome mask and BBar hide never ran (blue connect-bar stayed visible).
    // The unmistakable signal is the 'HwndWrapper[vmconnect.exe;...]' video child;
    // its top is the exact chrome height to clip.
    let mut vmconnect_pid: Option<u32> = None;
    let vmconnect_video = find_vmconnect_video_rect(child_hwnd);
    #[cfg(debug_assertions)]
    dlog!("[swallow-tree] DECISION frame_class='{}' vmconnect_video={:?} get_offset={}",
        class_str, vmconnect_video.map(|r| r.top), offset);
    let mut offset_x = 0;
    if let Some(vr) = vmconnect_video {
        if vr.top > 0 && vr.top < 200 {
            offset = vr.top;
            #[cfg(debug_assertions)]
            eprintln!("[swallow-tree] vmconnect measured top chrome = {}px", offset);
        }
        // WinForms lays the video child a few px in from the frame's left edge;
        // uncompensated, that many px of the VM's right side fall outside the slot.
        if vr.left > 0 && vr.left <= 20 {
            offset_x = vr.left;
        }
        let mut pid = 0u32;
        unsafe { let _ = GetWindowThreadProcessId(child_hwnd, Some(&mut pid)); }
        #[cfg(debug_assertions)]
        dump_owned_top_level_windows(pid, child_hwnd);
        hide_vmconnect_bbar(pid);
        vmconnect_pid = Some(pid);
    }

    // RDP (mstsc): offset stays 0. The connection bar is a fullscreen-only element and
    // we launch windowed (screen mode id:1), so there's no bar to mask. A non-zero RDP
    // offset corrupts resize geometry (the frame is sized height+offset, desyncing the
    // jitter filter and overflowing the surface), so we deliberately don't clip here.
    // smart sizing:i:1 in the .rdp scales the bitmap to fill the slot instead.

    let (original_style, original_ex_style, original_parent) = unsafe {
        let mut pid = 0;
        let _tid = GetWindowThreadProcessId(child_hwnd, Some(&mut pid));
        let s = GetWindowLongPtrW(child_hwnd, GWL_STYLE);
        let ex = GetWindowLongPtrW(child_hwnd, GWL_EXSTYLE);
        let p = windows::Win32::UI::WindowsAndMessaging::GetParent(child_hwnd).unwrap_or(HWND(std::ptr::null_mut()));
        (s, ex, p)
    };

    let mut style = original_style;
    style &= !(WS_POPUP.0 as isize);
    let mut ex_style = original_ex_style;
    ex_style &= !(WS_EX_TOPMOST.0 as isize);
    ex_style &= !(WS_EX_APPWINDOW.0 as isize);
    ex_style &= !(WS_BORDER.0 as isize); 
    ex_style |= (WS_EX_MDICHILD.0) as isize;

    // Strip thick frame and caption to ensure the window fits the slot precisely
    style &= !(WS_CAPTION.0 as isize);
    style &= !(WS_THICKFRAME.0 as isize);
    style &= !(WS_BORDER.0 as isize);
    style |= WS_CHILD.0 as isize;
    style |= WS_CLIPSIBLINGS.0 as isize;

    unsafe {
        let _ = SetWindowLongPtrW(child_hwnd, GWL_STYLE, style);
        let _ = SetWindowLongPtrW(child_hwnd, GWL_EXSTYLE, ex_style);

        // vmconnect's menu bar (파일/작업/미디어/클립보드/보기/도움말) is a real
        // window menu — WS_CAPTION stripping does NOT remove it. SetMenu(None) does.
        // Combined with the caption strip and the HYPERV_OFFSET toolbar mask, this
        // leaves just the VM display in the slot.
        if vmconnect_pid.is_some() {
            let _ = SetMenu(child_hwnd, None);
        }
    }

    unsafe {
        // Prepare parent for clipping
        let mut p_style = GetWindowLongPtrW(actual_parent, GWL_STYLE);
        p_style |= 0x02000000_isize; // WS_CLIPCHILDREN
        let _ = SetWindowLongPtrW(actual_parent, GWL_STYLE, p_style);

        let _ = SetParent(child_hwnd, actual_parent);

        // REVERTED (2026-07): a GetParent()-based post-check used to live here,
        // rejecting the swallow if GetParent didn't immediately report
        // actual_parent. It false-positived on real mstsc/vmconnect windows —
        // observed failing ordinary same-user RDP swallows (TscShellContainerClass,
        // ALREADY-VISIBLE not vmconnect) that were in fact fine a moment later.
        // Root cause not fully confirmed, but the prime suspect is the WS_EX_MDICHILD
        // bit set above (this window has no real MDICLIENT parent, so its
        // GetParent/SetParent bookkeeping isn't guaranteed to behave like a plain
        // WS_CHILD window) combined with mstsc's own thread being busy establishing
        // the RDP session at the exact moment we check. Do NOT re-add a
        // GetParent-based verification here without live-testing against a real
        // mstsc AND vmconnect swallow first — a synthetic same-process test window
        // (no WS_EX_MDICHILD, idle thread) will not reproduce the false positive.
        let mut state = lock_state();
        
        // Final coordinate calibration:
        // If we are parented to the main window, we might need to adjust for the title bar
        // but rect.y is usually viewport-relative. If it still drifts, we adjust here.
        let mut class_name_buf = [0u16; 256];
        let len = GetClassNameW(actual_parent, &mut class_name_buf);
        let _p_class = String::from_utf16_lossy(&class_name_buf[..len as usize]);
        
        state.insert(slot_id.to_string(), SwallowInfo {
            child_hwnd: child_hwnd.0 as isize,
            original_style,
            original_ex_style,
            original_parent: original_parent.0 as isize,
            x, y, width, height,
            parent_hwnd: actual_parent.0 as isize,
            is_visible: true,
            class_name: class_str.clone(),
            offset,
            offset_x,
            vmconnect_pid,
            header_cutout: None,
        });

        let (fx, fy, fw, fh) = framed_rect(x, y, width, height, offset_x, offset);
        let _ = SetWindowPos(
            // 최초 배치도 최상단으로 — 웹뷰 표면 위에 있어야 보인다(위 set_visibility 주석 참고).
            child_hwnd, HWND_TOP,
            fx, fy, fw, fh,
            SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_NOCOPYBITS
        );

        // Clip the non-removable chrome (e.g. VMConnect ribbon + left inset),
        // composed with any currently-active immersive reveal band.
        apply_chrome_region(child_hwnd, offset_x, offset, width, height, None);
    }

    // NOTE: NO WS_EX_LAYERED fade-in here. A layered child window kept mstsc from
    // updating its own cursor/overlay (mouse stuck on the default arrow, input
    // field I-beam never appeared, autocomplete popups didn't fire) — layered DWM
    // composition doesn't play with the RDP surface's live cursor draw. The
    // cosmetic ease-in isn't worth breaking VM input; if a fade is ever wanted it
    // must not use WS_EX_LAYERED on the swallowed child.

    let h_child_raw = child_hwnd.0 as isize;
    let h_parent_raw = actual_parent.0 as isize;
    let s_id = slot_id.to_string();
    let target_style = style;
    let target_ex_style = ex_style;
    let mut offset_cap = offset; // capture for stabilization loop (re-measured for vmconnect)
    let mut offset_x_cap = offset_x;
    let vmconnect_pid_cap = vmconnect_pid; // re-check the BBar each poll; it can reopen on focus/unmaximize
    // Horizon 데스크톱 프레임인지 — 클래스에 Horizon/Omnissa/VMware가 들어간다
    // (`HwndWrapper[Horizon.Client.UI;;GUID]`). 여기서 한 번만 판정해 루프로 넘긴다.
    let is_horizon_cap = {
        let c = class_str.to_lowercase();
        c.contains("horizon") || c.contains("omnissa") || c.contains("vmware")
    };
    dlog!("[horizon] frame class='{}' is_horizon={}", class_str, is_horizon_cap);
    // Horizon은 자체 연결 바(핀 / Ctrl+Alt+Del / USB / 전체 화면 종료)를 화면 상단
    // 정중앙에 띄우는데, 그 자리가 우리 헤더 필과 정확히 겹친다 — 필을 못 잡고
    // Alt+1~4도 그쪽으로 새는 원인이다. vmconnect의 BBar처럼 숨겨야 하는데,
    // 클래스명을 추측하지 말고 실측한다(CLAUDE.md 규칙). 프레임의 자식이 아니라
    // 같은 프로세스가 소유한 **별도 최상위 창**이라 child 덤프에는 안 잡힌다.
    #[cfg(debug_assertions)]
    if is_horizon_cap {
        let mut hz_pid = 0u32;
        unsafe { let _ = GetWindowThreadProcessId(child_hwnd, Some(&mut hz_pid)); }
        dump_owned_top_level_windows(hz_pid, child_hwnd);
    }

    std::thread::spawn(move || {
        // Adaptive backoff: apps fight hardest right after swallow, so poll fast
        // (100ms) then ease off to 1s once the window stays put. Any correction
        // resets to fast. Runs for the LIFE of the swallow, not a fixed window —
        // this loop doubles as the slot watchdog: the IsWindow check below is
        // what detects a crashed/closed child and emits `window-closed`. The old
        // 40s deadline meant a child dying at 41s left the slot showing a corpse
        // until the user clicked it. At the 1s idle rate the cost is one cheap
        // wakeup per second per slot. ponytail: heuristic backoff, swap for
        // SetWinEventHook only if a real app still escapes.
        const FAST_MS: u64 = 100;
        const SLOW_MS: u64 = 1000;
        #[cfg(debug_assertions)]
        let start = std::time::Instant::now();
        let mut interval_ms = FAST_MS;
        // WIP: re-dump the tree once ~6s in, after a Basic→Enhanced session-mode
        // switch would have replaced the child tree. Confirms whether the chrome we
        // measured at swallow time still matches the settled session.
        #[cfg(debug_assertions)]
        let mut redumped = false;
        // 이 슬롯 목숨 동안 누적 — 매 틱 리셋 아님. 정상 확인되면 0으로 되돌아간다.
        // 계속 실패하면 5회에서 포기해 죽은 세션에 영원히 SetWindowPos를 퍼붓지 않는다.
        //
        // set_visibility(hide/show)에는 이 복구를 다시 넣지 말 것 — "슬롯 전환만으로도
        // 8x8 붕괴" 이론은 실기기로 반증됐다(위 set_visibility의 철회 코멘트 참고).
        // 이건 그것과 다른 현상이다: hide/show 없이 **연결 6초 뒤 자연발생**으로 붕괴하는
        // 경우가 실측됐고(2026-08-31 dlog, SETTLED re-dump가 아무 트리거 없이 8x8을
        // 찍음), 그걸 잡을 유일한 경로였던 refresh_after_restore는 진짜 OS 최소화→복원
        // 에서만 돈다 — 최소화를 안 하면 영원히 검은 채로 남는다. 이 안정화 루프는 이미
        // 슬롯 목숨 내내 100ms~1s로 계속 도는 유일한 상시 감시자라 여기가 맞는 자리다.
        #[cfg(debug_assertions)]
        let mut health_at = std::time::Instant::now();
        // 붕괴 상태 엣지 추적 — 지속되는 동안 반복 복구하지 않기 위해서다.
        let mut was_collapsed = false;
        // Horizon 서피스 탐색 결과를 한 번만 로그하기 위한 플래그.
        let mut horizon_probed = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(interval_ms));

            #[cfg(debug_assertions)]
            if !redumped && start.elapsed().as_secs() >= 6 {
                redumped = true;
                let h = HWND(h_child_raw as *mut _);
                if unsafe { IsWindow(h).as_bool() } {
                    dlog!("[swallow-tree] ==== SETTLED re-dump (6s) ====");
                    dump_window_tree(h);
                    dump_container_siblings(HWND(h_parent_raw as *mut _), h_child_raw);
                }
            }

            let (target_rect, is_visible, is_active, cutout) = {
                let state = lock_state();
                if let Some(info) = state.get(&s_id) {
                    if info.child_hwnd != h_child_raw { break; }
                    ((info.x, info.y, info.width, info.height), info.is_visible, true, info.header_cutout)
                } else {
                    ((0, 0, 0, 0), false, false, None)
                }
            };
            if !is_active { break; }
            if !is_visible { continue; }

            if let Some(pid) = vmconnect_pid_cap {
                hide_vmconnect_bbar(pid);
            }
            keep_superseded_hidden(&s_id);

            let h_child = HWND(h_child_raw as *mut _);
            let h_parent = HWND(h_parent_raw as *mut _);
                
            unsafe {
                if !IsWindow(h_child).as_bool() {
                    let mut lock = lock_state();
                    if let Some(info) = lock.get(&s_id) {
                        if info.child_hwnd == h_child_raw {
                            lock.remove(&s_id);
                            // Emit window-closed event
                            let _ = app_handle.emit("window-closed", s_id.clone());
                        }
                    }
                    break;
                }
                
                let cur_style = GetWindowLongPtrW(h_child, GWL_STYLE);
                let cur_ex_style = GetWindowLongPtrW(h_child, GWL_EXSTYLE);
                let cur_parent = windows::Win32::UI::WindowsAndMessaging::GetParent(h_child).unwrap_or(HWND(std::ptr::null_mut()));

                let mut needs_refresh = false;

                // vmconnect: a Basic↔Enhanced session-mode switch REPLACES the child
                // tree. Enhanced is an RDP tree (UIMainClass/...) with NO HwndWrapper
                // video child, so the chrome measured at swallow time goes stale — the
                // old mask then shifts the surface and leaves gaps at the slot edges.
                // Re-measure BOTH axes every poll and reposition + re-clip on change.
                // (Also self-corrects the Basic-mode measurement taken before
                // SetMenu(None) shrank the chrome.)
                if vmconnect_pid_cap.is_some() {
                    // Total chrome = frame's own non-client border (the white edge in
                    // Enhanced session) PLUS any internal ribbon (Basic session's
                    // HwndWrapper child sits inside the client area). The video-rect
                    // helper reports the ribbon in CLIENT coords, so adding the border
                    // converts to the window-relative offset the region/reposition use.
                    let (nc_x, nc_y) = frame_nc_border(h_child);
                    let (in_x, in_y) = match find_vmconnect_video_rect(h_child) {
                        Some(vr) => (
                            vr.left.clamp(0, 20),
                            if vr.top > 0 && vr.top < 200 { vr.top } else { 0 },
                        ),
                        None => (0, 0), // Enhanced: content fills the client, no ribbon
                    };
                    let mx = nc_x + in_x;
                    let my = nc_y + in_y;
                    if mx != offset_x_cap || my != offset_cap {
                        #[cfg(debug_assertions)]
                        dlog!("[swallow] vmconnect chrome ({},{})px -> ({},{})px [nc=({},{}) ribbon=({},{})]",
                            offset_x_cap, offset_cap, mx, my, nc_x, nc_y, in_x, in_y);
                        offset_x_cap = mx;
                        offset_cap = my;
                        {
                            let mut st = lock_state();
                            if let Some(i) = st.get_mut(&s_id) {
                                i.offset = offset_cap;
                                i.offset_x = offset_x_cap;
                            }
                        }
                        needs_refresh = true;
                    }
                }

                if cur_style != target_style {
                    let _ = SetWindowLongPtrW(h_child, GWL_STYLE, target_style);
                    needs_refresh = true;
                }
                if cur_ex_style != target_ex_style {
                    let _ = SetWindowLongPtrW(h_child, GWL_EXSTYLE, target_ex_style);
                    needs_refresh = true;
                }
                if cur_parent.0 != h_parent.0 {
                    let _ = SetParent(h_child, h_parent);
                    needs_refresh = true;
                }

                // **위치만** 되돌린다(SWP_NOSIZE). 크기는 절대 안 건드린다 — 예전
                // 폭풍(400회+)은 전부 도달 불가능한 **크기**를 요구해서 났고, mstsc가
                // 슬롯보다 큰 건 정상이라 region이 잘라주면 된다.
                //
                // 위치는 다르다. Horizon 데스크톱 프레임은 SetParent 전 화면 좌표를
                // 그대로 들고 있어서 부모 기준으로 재해석되면 화면 밖으로 튄다
                // (실측 2026-09-03: at=(1920,0) want=(223,40) → 화면 3840, 모니터 밖).
                // 아무도 안 고치면 슬롯은 영원히 빈 채로 남는다.
                {
                    let (want_x, want_y, _, _) = framed_rect(
                        target_rect.0, target_rect.1, target_rect.2, target_rect.3,
                        offset_x_cap, offset_cap);
                    let mut wr = RECT::default();
                    if GetWindowRect(h_child, &mut wr).is_ok() {
                        let mut tl = POINT { x: wr.left, y: wr.top };
                        let _ = ScreenToClient(h_parent, &mut tl);
                        if (tl.x - want_x).abs() > 2 || (tl.y - want_y).abs() > 2 {
                            dlog!("[stabilize] slot={} child={:?} POS ({},{}) -> ({},{})",
                                s_id, h_child_raw, tl.x, tl.y, want_x, want_y);
                            let _ = SetWindowPos(h_child, HWND_TOP, want_x, want_y, 0, 0,
                                SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE);
                        }
                    }
                }

                // NOTE(2026-09-02): 여기에 "프레임 rect를 목표와 대조해 되돌리는" 보정을
                // 넣었다가 **제거**했다. 실측으로 두 가지가 드러났다:
                //  (1) vmconnect의 크롬 재측정이 불안정해 목표 자체가 매 폴 바뀐다
                //      (chrome (0,0)↔(2,2)↔(5,20) → framed_rect도 같이 요동) → 보정이
                //      그걸 쫓아가며 창을 물리적으로 흔든다(실측 진동 로그 확인).
                //  (2) set_visibility가 플래그를 먼저 쓰고 락을 놓은 뒤 SetWindowPos를
                //      하므로, 그 사이 폴이 숨은 창(-10000,-10000)을 "어긋났다"고 보고
                //      화면으로 도로 끌어낸다.
                // 위치가 어긋나는 진짜 케이스가 있다면 목표가 **안정된 뒤에** 판단해야
                // 하고, set_visibility와의 경합도 같이 풀어야 한다. 그 설계 없이
                // 단순 rect 강제를 다시 넣지 말 것.

                // Horizon: 렌더 서피스가 프레임을 안 따라오므로 따로 붙여준다.
                // 프레임의 클라이언트 영역을 화면 좌표로 바꿔 그대로 목표로 준다.
                if is_horizon_cap {
                    // 연결 바는 포커스/전환 때마다 되살아나므로 매 폴 숨긴다
                    // (vmconnect BBar와 같은 이유).
                    {
                        let mut hz_pid = 0u32;
                        let _ = GetWindowThreadProcessId(h_child, Some(&mut hz_pid));
                        if hz_pid != 0 { hide_horizon_bars(hz_pid, h_child); }
                    }
                    // 서피스를 찾았는지 **한 번만** 남긴다. sync_horizon_surface는
                    // 못 찾으면 조용히 false를 주므로, 그것만으로는 "안 돌았다"와
                    // "돌았는데 못 찾았다"가 구분이 안 된다 — 검은 화면 원인을 가르는
                    // 결정적 정보라 명시적으로 찍는다.
                    // **찾을 때까지** 계속 본다. Horizon은 접속 직후 MKS 트리를
                    // 늦게 만든다(실측: 스왈로우 시점엔 WswcRdpClass가 0x0이고
                    // MKSEmbedded는 아예 없다가 ~6초 뒤에 생긴다). 한 번만 보고
                    // 끝내면 "없다"고 오판한다.
                    if !horizon_probed {
                        if let Some(_sfc) = find_descendant_by_class(h_child, "MKSEmbedded") {
                            horizon_probed = true;
                            dlog!("[horizon] MKSEmbedded FOUND {:?}", _sfc.0);
                        }
                    }
                    let mut cr = RECT::default();
                    if windows::Win32::UI::WindowsAndMessaging::GetClientRect(h_child, &mut cr).is_ok() {
                        let mut origin = POINT { x: 0, y: 0 };
                        let _ = ClientToScreen(h_child, &mut origin);
                        let target = RECT {
                            left: origin.x,
                            top: origin.y,
                            right: origin.x + (cr.right - cr.left),
                            bottom: origin.y + (cr.bottom - cr.top),
                        };
                        if sync_horizon_surface(h_child, target) {
                            interval_ms = FAST_MS; // 방금 옮겼으면 잠시 촘촘히 지켜본다
                        }
                    }
                }

                // 진단만 한다(창을 건드리지 않음). 검은 화면일 때 어느 불변식이
                // 깨졌는지 한 줄로 보려는 용도 — 프레임 좌표는 `framed_rect`와 같은
                // **부모-클라이언트 기준**으로 찍는다(화면 좌표로 찍으면 부모가 최소화
                // 주차 위치에 있을 때 -31771 같은 값이 나와 오해를 부른다).
                #[cfg(debug_assertions)]
                if health_at.elapsed().as_millis() >= 2000 {
                    health_at = std::time::Instant::now();
                    let mut wr = RECT::default();
                    if GetWindowRect(h_child, &mut wr).is_ok() {
                        let mut tl = POINT { x: wr.left, y: wr.top };
                        let _ = ScreenToClient(h_parent, &mut tl);
                        let mut rb = RECT::default();
                        let rgn = windows::Win32::Graphics::Gdi::GetWindowRgnBox(h_child, &mut rb);
                        let (fx, fy, fw, fh) = framed_rect(
                            target_rect.0, target_rect.1, target_rect.2, target_rect.3,
                            offset_x_cap, offset_cap);
                        dlog!("[health] slot={} child={:?} at=({},{} {}x{}) want=({},{} {}x{}) vis={} iconic={} collapsed={} parent_ok={} top={} rgn={:?}({},{} {}x{}) chrome=({},{}) client={}x{} child={:?}",
                            s_id, h_child_raw,
                            tl.x, tl.y, wr.right - wr.left, wr.bottom - wr.top,
                            fx, fy, fw, fh,
                            IsWindowVisible(h_child).as_bool(),
                            IsIconic(h_child).as_bool(),
                            child_surface_collapsed(h_child),
                            cur_parent.0 == h_parent.0,
                            // 부모의 z-order 최상단 자식이 우리인가 — 아니면 웹뷰가 위를
                            // 덮고 있다는 뜻이고, 그게 곧 검은 화면이다.
                            windows::Win32::UI::WindowsAndMessaging::GetWindow(
                                h_parent, windows::Win32::UI::WindowsAndMessaging::GW_CHILD)
                                .map(|w| w.0 == h_child.0).unwrap_or(false),
                            rgn.0, rb.left, rb.top, rb.right - rb.left, rb.bottom - rb.top,
                            offset_x_cap, offset_cap,
                            {
                                let mut c = RECT::default();
                                let _ = windows::Win32::UI::WindowsAndMessaging::GetClientRect(h_child, &mut c);
                                c.right - c.left
                            },
                            {
                                let mut c = RECT::default();
                                let _ = windows::Win32::UI::WindowsAndMessaging::GetClientRect(h_child, &mut c);
                                c.bottom - c.top
                            },
                            first_child_rect(h_child).map(|r| (r.left, r.top, r.right - r.left, r.bottom - r.top)));
                    }
                }

                // 붕괴가 **새로 발생했을 때만 1회** 되살린다. 예전엔 붕괴가 지속되는
                // 동안 매 폴 복구를 시도해 도달 불가능한 크기를 요구하는 폭풍이 났다
                // (실측 400회+). 이제는 `was_collapsed` 엣지로 막는다 — 접힘이 풀렸다가
                // 다시 접히면 그때 또 1회. 넛지가 실제로 듣는다는 건 확인됐다
                // (실측: [show] 경로에서 8x8 -> 1920x1040 복구).
                let now_collapsed = child_surface_collapsed(h_child);
                if now_collapsed && !was_collapsed {
                    dlog!("[stabilize] slot={} child={:?} collapsed -> one-shot recover", s_id, h_child_raw);
                    let framed = framed_rect(target_rect.0, target_rect.1, target_rect.2, target_rect.3, offset_x_cap, offset_cap);
                    recover_collapsed_surface(h_child_raw, framed, (offset_x_cap, offset_cap, target_rect.2, target_rect.3), cutout);
                    // 넛지: 크기를 실제로 한 번 바꿔야 WM_SIZE가 나가 재레이아웃된다.
                    {
                        let (fx, fy, fw, fh) = framed;
                        let _ = SetWindowPos(h_child, HWND_TOP, fx, fy, (fw - 1).max(1), (fh - 1).max(1),
                            SWP_SHOWWINDOW | SWP_NOACTIVATE);
                        let _ = SetWindowPos(h_child, HWND_TOP, fx, fy, fw, fh,
                            SWP_SHOWWINDOW | SWP_NOACTIVATE);
                    }
                    apply_chrome_region(h_child, offset_x_cap, offset_cap, target_rect.2, target_rect.3, cutout);
                }
                was_collapsed = now_collapsed;

                // NOTE(2026-09-02): 상시 붕괴 감지 + 넛지 복구도 여기 있었으나 제거했다.
                // 실측에서 (a) 넛지가 접힌 표면을 되살린 적이 한 번도 없었고
                // (`first-child size = 8x8`이 6회 시도 내내 그대로), (b) 도달 불가능한
                // 크기를 요구하는 폭풍(400회+)만 만들었다. 감지 자체는 `[health]`
                // 로그로 계속 관찰 가능하니, 원인을 특정하기 전에 능동 보정을 다시
                // 넣지 말 것.

                if needs_refresh {
                    let (fx, fy, fw, fh) = framed_rect(target_rect.0, target_rect.1, target_rect.2, target_rect.3, offset_x_cap, offset_cap);
                    let _ = SetWindowPos(
                        h_child,
                        HWND_TOP,
                        fx, fy, fw, fh,
                        SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE
                    );
                    // Re-apply chrome clip region in case the app reset it — composed
                    // with any active immersive reveal band via apply_chrome_region,
                    // so this can never stomp a reveal the top-edge poller just made.
                    apply_chrome_region(h_child, offset_x_cap, offset_cap, target_rect.2, target_rect.3, cutout);
                    interval_ms = FAST_MS; // app fought back — watch closely again
                } else {
                    interval_ms = (interval_ms * 2).min(SLOW_MS); // stable — ease off
                }
            }
        }
    });
    
    Ok(())
}

/// "Disconnect" a slot: end the session (RDP disconnect / VM console close),
/// not just hide it elsewhere. mstsc/vmconnect handle WM_CLOSE themselves —
/// for RDP that's a real disconnect, for a Hyper-V console it just closes the
/// viewer (the VM itself is untouched, same as closing it from Hyper-V
/// Manager). We first restore the window to a normal top-level frame (in case
/// the app shows its own "really disconnect?" prompt and the user cancels —
/// then it's left as an ordinary floating window instead of stuck invisible
/// inside HyperDesk's webview container).
/// Win32 teardown shared by `unswallow` and the hunt loop's stale-commit
/// cleanup: restore the child to a normal floating top-level window, then post
/// WM_CLOSE. Caller must have already removed the slot from SWALLOW_STATE (this
/// only touches the window). Deliberately does NOT hold lock_state — a Win32
/// call must never block while holding the state mutex.
fn restore_and_close(info: &SwallowInfo) {
    let child_hwnd = HWND(info.child_hwnd as *mut _);
    unsafe {
        if IsWindow(child_hwnd).as_bool() {
            let _ = SetParent(child_hwnd, HWND(std::ptr::null_mut()));
            let _ = SetWindowLongPtrW(child_hwnd, GWL_STYLE, info.original_style);
            let _ = SetWindowLongPtrW(child_hwnd, GWL_EXSTYLE, info.original_ex_style);
            let _ = SetWindowRgn(child_hwnd, HRGN::default(), BOOL::from(true));
            if info.original_parent != 0 {
                 let _ = SetParent(child_hwnd, HWND(info.original_parent as *mut _));
            }
            let _ = SetWindowPos(child_hwnd, HWND(std::ptr::null_mut()), 120, 120, 900, 650,
                SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOZORDER);
            let _ = PostMessageW(child_hwnd, WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }
}

pub fn unswallow(slot_id: &str) -> Result<(), String> {
    // 체인 잔재 목록도 같이 비운다 — 안 지우면 다음 세션에서 남의 hwnd를 숨기려 든다.
    superseded().lock().unwrap_or_else(|e| e.into_inner()).remove(slot_id);
    // Invalidate any in-flight hunt for this slot FIRST — cancelling a connect
    // before a session window ever appears has nothing in SWALLOW_STATE to
    // remove below, so without this the hunt thread would keep running and
    // could commit a "connected" slot well after the user cancelled it.
    bump_generation(slot_id);
    // Take the entry out under the lock, then release BEFORE the Win32 teardown.
    let removed = lock_state().remove(slot_id);
    if let Some(info) = removed {
        restore_and_close(&info);
    }
    Ok(())
}

pub fn unswallow_all() {
    let keys: Vec<String> = {
        let state = lock_state();
        state.keys().cloned().collect()
    };
    for key in keys {
        let _ = unswallow(&key);
    }
}

pub fn set_visibility(slot_id: &str, visible: bool) -> Result<(), String> {
    // 스냅샷만 뜨고 락은 바로 놓는다 — 아래에서 SetWindowPos/apply_chrome_region 같은
    // Win32 호출을 하는 동안 lock_state()를 쥔 채로는 절대 안 된다(그동안 다른
    // 스레드의 swallow/unswallow/update_position이 전부 막힌다). (한때 여기서도
    // recover_collapsed_surface를 불러 최대 6*250ms 슬립했었는데, 그 근거였던
    // "슬롯 전환만으로도 8x8 붕괴" 실측이 이후 실기기로 반증되어 그 호출은 철회됐다
    // — 락을 짧게 쥐는 습관 자체는 계속 유효하므로 유지한다.)
    struct Snap { hwnd: isize, x: i32, y: i32, w: i32, h: i32, ox: i32, oy: i32, cut: Option<CutoutRect> }
    let snap = {
        let mut state = lock_state();
        let Some(info) = state.get_mut(slot_id) else { return Ok(()) };
        info.is_visible = visible;
        Snap {
            hwnd: info.child_hwnd, x: info.x, y: info.y, w: info.width, h: info.height,
            ox: info.offset_x, oy: info.offset, cut: info.header_cutout,
        }
    };

    let hwnd = HWND(snap.hwnd as *mut _);
    if !unsafe { IsWindow(hwnd) }.as_bool() {
        return Ok(());
    }

    if visible {
        // The offsets resolved (and possibly re-measured) at swallow time —
        // NOT get_offset(class), which knows nothing about the measured
        // vmconnect chrome and would misplace the frame on re-show.
        let (fx, fy, fw, fh) = framed_rect(snap.x, snap.y, snap.w, snap.h, snap.ox, snap.oy);
        unsafe {
            let _ = SetWindowPos(
                // **HWND_TOP으로 끌어올린다.** SwallowGrid는 Win32 자식이 WebView2
                // 표면 **위**에 있다는 전제로 동작하는데, 예전엔 여기서 SWP_NOZORDER를
                // 써서 z-order를 손대지 않았다 — 자식이 어떤 이유로든 웹뷰 아래로
                // 내려가 있으면 슬롯을 다시 보여줘도 웹뷰가 칠하는 배경(#000)만 보인다.
                // 실측(2026-09-02 [health]): 위치·크기·region·가시성·부모가 전부 정답인데
                // 화면만 검은 상태가 나왔고, 남은 변수가 z-order뿐이었다.
                hwnd, HWND_TOP,
                fx, fy, fw, fh,
                SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE
            );
        }
        // 반드시 region도 같이 다시 적용한다. 숨어 있는 동안 update_position은
        // `is_visible` 가드에 걸려 SetWindowPos/region을 건너뛰지만 저장된
        // x/y/width/height는 **갱신한다** — 그래서 슬롯이 숨은 사이에 커지면
        // (슬롯 전환, 전체화면/몰입 진입, 창 리사이즈) 위 SetWindowPos는 새
        // 크기로 가는데 region은 예전 작은 사각형에 머문다. RDP는 offset이 0이라
        // region이 곧 슬롯 사각형이므로, 그 차이만큼 **아래쪽이 잘려** 원격
        // 데스크톱의 작업표시줄이 사라진 것처럼 보인다. set_header_cutout도
        // 숨은 동안엔 값만 저장하고 적용을 건너뛰므로 같이 밀린다.
        apply_chrome_region(hwnd, snap.ox, snap.oy, snap.w, snap.h, snap.cut);

        // 숨는 동안 mstsc가 내부 표면을 8x8로 접는다(실측 2026-09-02: 슬롯을 숨기면
        // `TscShellAxHostClass`/`UIMainClass`가 (-10000,-10000) 8x8이 된다. 바로 위
        // `UIContainerClass`는 1920x1080 그대로라 프레임 크기 문제가 아니다).
        // 다시 보일 때 위 SetWindowPos는 **위치만** 바꾼다 — 숨길 때 크기를 유지하는
        // 설계이므로 크기 변화가 없고, 크기가 안 변하면 Windows는 WM_SIZE를 안 보낸다.
        // WM_SIZE가 없으면 mstsc는 재레이아웃을 안 하고 8x8인 채로 남는다 = 검은 화면.
        //
        // **접힌 게 확인될 때만, 딱 1회** 진짜 크기 변화를 준다. 무조건/반복으로 하면
        // 살아있는 세션에 WM_SIZE를 퍼부어 smart-sizing 스케일만 흔든다
        // ([[swallow-resize-is-rdp-limit]], 실측 폭풍 400회+). 조건부 1회가 핵심이다.
        if child_surface_collapsed(hwnd) {
            dlog!("[show] slot={} child={:?} surface collapsed -> one-shot resize nudge", slot_id, snap.hwnd);
            unsafe {
                let _ = SetWindowPos(
                    hwnd, HWND_TOP, fx, fy, (fw - 1).max(1), (fh - 1).max(1),
                    SWP_SHOWWINDOW | SWP_NOACTIVATE,
                );
                let _ = SetWindowPos(
                    hwnd, HWND_TOP, fx, fy, fw, fh,
                    SWP_SHOWWINDOW | SWP_NOACTIVATE,
                );
            }
            apply_chrome_region(hwnd, snap.ox, snap.oy, snap.w, snap.h, snap.cut);
        }

    } else {
        // Move off-screen WITHOUT resizing (previously a hardcoded 800x600).
        // That resize was a real WM_SIZE on a live mstsc session — classic
        // mstsc renegotiates its smart-sizing scale on resize (see
        // swallow-resize-is-rdp-limit memory), so shrinking to 800x600 here
        // and back to the slot size on reveal could desync that scale,
        // leaving the RDP content rendering at native/unscaled resolution
        // (overflowing the slot, including over the taskbar) after a slot
        // switch. Keeping the size stable across hide/show avoids the
        // resize event entirely.
        let (_, _, fw, fh) = framed_rect(snap.x, snap.y, snap.w, snap.h, snap.ox, snap.oy);
        unsafe {
            let _ = SetWindowPos(
                hwnd, HWND(std::ptr::null_mut()),
                -10000, -10000, fw, fh,
                SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE
            );
        }
    }
    Ok(())
}

/// 프레임의 클라이언트 영역 대비 **첫 자식이 터무니없이 작으면** 접힌 것으로 본다.
///
/// 최소화 동안 mstsc는 `TscShellAxHostClass`(프레임의 첫 자식) 이하를 8x8로 접는다
/// (실측 2026-08-26). 평소엔 그 자식이 프레임보다 오히려 **크다** — mstsc는 표면을
/// 프레임에 맞춰 줄이지 않고 프레임이 잘라낼 뿐이다(실측: 프레임 클라이언트
/// 1476x986인데 자식은 1920x1040). 그래서 "자식이 클라이언트 면적의 절반도 안 된다"는
/// 정상 상태에서 절대 참이 되지 않고, 8x8(면적 64)에서만 참이 된다.
/// Horizon(Omnissa) 데스크톱의 실제 렌더 서피스를 슬롯에 강제로 붙인다.
///
/// Horizon은 프레임(`HwndWrapper[Horizon.Client.UI;;...]`)만 SetParent로 슬롯에
/// 넣어도 화면이 검다 — 표시 스택(`RemoteWindow` → `MainMKSClass` → `WswcRdpClass`
/// → `MKSScreenWindow` → `MKSEmbedded`)이 **모니터 절대좌표에 고정**되어 프레임을
/// 안 따라오기 때문이다(실측: 프레임을 옮겨도 `MKSEmbedded rect=(1920,0 1920x1080)`).
///
/// 라이브 프로브(`horizon_force_embed_experiment`)로 확인: 그 서피스를 SetWindowPos로
/// 밀어넣으면 **Horizon이 되돌리지 않는다**(10초/100틱 위치 유지, 되찾기 0회).
/// 이미 목표에 있으면 아무것도 하지 않으므로 불필요한 SetWindowPos는 없다.
///
/// 좌표 주의: `MKSEmbedded`는 WS_CHILD라 SetWindowPos가 **부모-클라이언트 기준**이다.
/// 목표는 화면 좌표로 계산한 뒤 `ScreenToClient`로 변환할 것 — 빼면 부모 원점이
/// (0,0)이 아닌 순간 그대로 어긋난다(유닛 테스트로 고정).
fn sync_horizon_surface(frame: HWND, target_screen: RECT) -> bool {
    let Some(surface) = find_descendant_by_class(frame, "MKSEmbedded") else { return false };
    unsafe {
        if !IsWindow(surface).as_bool() { return false; }
        let (tw, th) = (target_screen.right - target_screen.left,
                        target_screen.bottom - target_screen.top);
        if tw <= 0 || th <= 0 { return false; }

        let mut cur = RECT::default();
        if GetWindowRect(surface, &mut cur).is_err() { return false; }
        if cur.left == target_screen.left && cur.top == target_screen.top
            && (cur.right - cur.left) == tw && (cur.bottom - cur.top) == th {
            return false; // 이미 제자리
        }

        let parent = windows::Win32::UI::WindowsAndMessaging::GetParent(surface)
            .unwrap_or(HWND(std::ptr::null_mut()));
        let mut tl = POINT { x: target_screen.left, y: target_screen.top };
        let _ = ScreenToClient(parent, &mut tl);
        let _ = SetWindowPos(surface, HWND(std::ptr::null_mut()), tl.x, tl.y, tw, th,
            SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOZORDER);
        dlog!("[horizon] surface {:?} ({},{} {}x{}) -> screen ({},{} {}x{})",
            surface.0, cur.left, cur.top, cur.right - cur.left, cur.bottom - cur.top,
            target_screen.left, target_screen.top, tw, th);
        true
    }
}

/// 프레임의 첫 자식(실제 렌더 서피스)의 **화면 좌표** rect. 진단용.
///
/// `[health]`가 프레임만 찍던 시절, 프레임이 전부 정상인데도 화면이 검은 케이스를
/// 설명하지 못했다 — 프레임이 제자리여도 그 안의 렌더 자식이 엉뚱한 자리/크기면
/// 슬롯엔 아무것도 안 보인다. 그 갭을 메우려고 같이 찍는다.
/// DEV-ONLY: swallow된 자식이 붙어 있는 **컨테이너의 자식들**을 z-order 순서로
/// 덤프한다(첫 줄 = 최상단).
///
/// "기하·region·가시성이 전부 정답인데 화면만 검다"를 만나면 남는 축은 **합성**뿐이다.
/// WebView2가 자식 HWND로 렌더하면 우리가 HWND_TOP이면 이기지만, DirectComposition
/// 비주얼로 렌더하면 DWM이 모든 자식 HWND 위에 합성해서 z-order로는 원리상 못 이긴다.
/// 그 둘을 가르려면 컨테이너 밑에 렌더용 자식 창이 실제로 있는지를 봐야 한다.
#[cfg(debug_assertions)]
fn dump_container_siblings(parent: HWND, ours: isize) {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindow, GW_CHILD, GW_HWNDNEXT, WS_EX_LAYERED, WS_EX_NOREDIRECTIONBITMAP};
    dlog!("[siblings] ==== children of container {:?} (z-order, first = topmost) ====", parent.0);
    unsafe {
        let mut c = GetWindow(parent, GW_CHILD).unwrap_or(HWND(std::ptr::null_mut()));
        let mut n = 0;
        while !c.0.is_null() && n < 20 {
            let mut buf = [0u16; 256];
            let len = GetClassNameW(c, &mut buf);
            let class = String::from_utf16_lossy(&buf[..len.max(0) as usize]);
            let mut r = RECT::default();
            let _ = GetWindowRect(c, &mut r);
            let ex = GetWindowLongPtrW(c, GWL_EXSTYLE);
            dlog!("[siblings] {}{:?} class='{}' rect=({},{} {}x{}) vis={} layered={} noredir={}",
                if c.0 as isize == ours { "*OURS* " } else { "" },
                c.0, class, r.left, r.top, r.right - r.left, r.bottom - r.top,
                IsWindowVisible(c).as_bool(),
                (ex & WS_EX_LAYERED.0 as isize) != 0,
                (ex & WS_EX_NOREDIRECTIONBITMAP.0 as isize) != 0);
            c = GetWindow(c, GW_HWNDNEXT).unwrap_or(HWND(std::ptr::null_mut()));
            n += 1;
        }
    }
}

// dlog!("[health]")에서만 쓴다 — 릴리즈에선 dlog!가 인자를 평가하지 않아
// 호출부가 사라지므로 dead_code가 된다. DLOG_START와 같은 이유로 프로파일을 맞춘다.
#[cfg(debug_assertions)]
fn first_child_rect(frame: HWND) -> Option<RECT> {
    unsafe {
        struct P { first: Option<HWND> }
        extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let p = unsafe { &mut *(lparam.0 as *mut P) };
            p.first = Some(hwnd);
            BOOL::from(false)
        }
        let mut p = P { first: None };
        let _ = EnumChildWindows(frame, Some(cb), LPARAM(&mut p as *mut P as isize));
        let child = p.first?;
        let mut r = RECT::default();
        if GetWindowRect(child, &mut r).is_err() { return None; }
        Some(r)
    }
}

fn child_surface_collapsed(frame: HWND) -> bool {
    unsafe {
        // 프레임 **자신**이 접힌 경우가 먼저다. 실측(2026-09-02): 프레임이 8x8인데
        // 그 자식은 1920x1080으로 남아 있어서, 자식만 보던 옛 판정은 "정상"이라고
        // 답했다. 프레임이 접히면 그 안에 뭐가 있든 화면엔 아무것도 안 보인다.
        let mut fr = RECT::default();
        if GetWindowRect(frame, &mut fr).is_ok()
            && (fr.right - fr.left) < 32 && (fr.bottom - fr.top) < 32 {
            dlog!("[restore] FRAME itself collapsed {}x{} (iconic={})",
                fr.right - fr.left, fr.bottom - fr.top, IsIconic(frame).as_bool());
            return true;
        }
        struct P { first: Option<HWND> }
        extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let p = unsafe { &mut *(lparam.0 as *mut P) };
            p.first = Some(hwnd);
            BOOL::from(false) // 첫 자식 하나면 충분하다
        }
        let mut p = P { first: None };
        let _ = EnumChildWindows(frame, Some(cb), LPARAM(&mut p as *mut P as isize));
        let Some(child) = p.first else { return false };
        let mut r = RECT::default();
        if GetWindowRect(child, &mut r).is_err() {
            return false;
        }
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        // 붕괴일 때만 찍는다 — 예전엔 무조건 찍어서 100ms마다 같은 줄이 쌓여
        // 정작 중요한 줄이 묻혔다.
        if w < 32 && h < 32 {
            dlog!("[restore] first-child COLLAPSED {}x{} (frame iconic={})",
                w, h, IsIconic(frame).as_bool());
        }
        // 절대 기준(px)으로 판정한다 — 예전엔 frame 자신의 GetClientRect와 비교하는
        // **상대** 비율이었는데, 실측(2026-08-26 dlog)으로 오탐이 확인됐다: frame이
        // 최소화 취급을 받으면 frame 자신의 클라이언트도 함께 0에 가깝게 무너지고,
        // 그러면 분자(자식 면적)와 분모(frame 면적)가 같이 작아져 비율 검사가 "붕괴
        // 아님"으로 통과해버린다(그 순간 로그: 프레임 0x510956의 자식이 8x8인데도
        // restore 체크는 "surface OK"). 실측된 붕괴 크기는 8x8이고 정상 세션은 항상
        // 수백~수천 px이므로, 절대 하한(32px)이면 이 자기참조 함정이 없다.
        w < 32 && h < 32
    }
}

/// 창을 **최소화했다 복원한 직후** 슬롯을 되살린다.
///
/// 최소화 왕복 동안 자식의 스타일도 부모도 안 바뀌므로 안정화 루프의 `needs_refresh`가
/// 계속 false다 — 즉 아무도 자식에게 "다시 그려라/다시 배치하라"고 말하지 않는다.
/// 동시에 최소화/복원은 Alt+Tab·Alt+1~4와 같은 셸 전체화면 재평가 트리거이기도 하다.
///
/// 락은 스냅샷만 뜨고 즉시 놓는다 — Win32 호출을 `lock_state()`를 쥔 채 하면 그동안
/// 다른 스레드의 swallow/unswallow가 전부 막힌다.
/// 복원 직후 슬롯을 마지막으로 알던 자리에 다시 적용한다.
///
/// **여기서 크기 넛지(1px 줄였다 되돌리기)를 하지 말 것.** 접힌 표면을 되살리려고
/// 그 방식을 넣어 6회까지 재시도해봤지만, 실측에서 `first-child size = 8x8`이
/// 여섯 번 내내 그대로였다 — 효과가 없고 살아있는 세션에 WM_SIZE만 퍼붓는다.
/// 원인이 특정되기 전까지는 위치/region/재도색만 한 번 다시 적용한다(무해).
fn recover_collapsed_surface(
    hwnd_raw: isize,
    framed: (i32, i32, i32, i32),
    chrome: (i32, i32, i32, i32),
    cutout: Option<CutoutRect>,
) {
    let (fx, fy, fw, fh) = framed;
    let (offset_x, offset, width, height) = chrome;
    let hwnd = HWND(hwnd_raw as *mut _);
    unsafe {
        if !IsWindow(hwnd).as_bool() { return; }
        // 최소화 상태면 SetWindowPos 자체가 무시된다(유닛 테스트
        // `setwindowpos_is_ignored_while_a_window_is_minimized`). 포커스를 뺏지
        // 않으려고 SW_RESTORE가 아니라 SW_SHOWNOACTIVATE를 쓴다.
        if IsIconic(hwnd).as_bool() {
            dlog!("[restore] child={:?} is ICONIC -> ShowWindow(SW_SHOWNOACTIVATE)", hwnd_raw);
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        let _ = SetWindowPos(
            hwnd, HWND(std::ptr::null_mut()), fx, fy, fw, fh,
            SWP_SHOWWINDOW | SWP_NOZORDER | SWP_NOACTIVATE,
        );
        apply_chrome_region(hwnd, offset_x, offset, width, height, cutout);
        let _ = RedrawWindow(hwnd, None, None,
            RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_UPDATENOW);
    }
    dlog!("[restore] slot child={:?} -> ({},{} {}x{})", hwnd_raw, fx, fy, fw, fh);
}
pub fn refresh_after_restore() {
    struct Item { hwnd: isize, x: i32, y: i32, w: i32, h: i32, ox: i32, oy: i32, cut: Option<CutoutRect> }
    let items: Vec<Item> = {
        lock_state().values()
            .filter(|i| i.is_visible)
            .map(|i| Item {
                hwnd: i.child_hwnd, x: i.x, y: i.y, w: i.width, h: i.height,
                ox: i.offset_x, oy: i.offset, cut: i.header_cutout,
            })
            .collect()
    };

    for it in items {
        let framed = framed_rect(it.x, it.y, it.w, it.h, it.ox, it.oy);
        recover_collapsed_surface(it.hwnd, framed, (it.ox, it.oy, it.w, it.h), it.cut);
    }

    // 최소화/복원도 Alt+Tab·슬롯 전환과 같은 셸 재평가 트리거다 — 전체화면 중이었다면
    // 작업표시줄이 다시 VM 위로 올라온다. focus_window와 동일한 재적용.
    if FULLSCREEN_ACTIVE.load(std::sync::atomic::Ordering::Relaxed) {
        let main = HWND(MAIN_HWND.load(std::sync::atomic::Ordering::Relaxed) as *mut _);
        if !main.0.is_null() {
            mark_fullscreen_native(main, true);
        }
    }
}

/// 떠 있는 헤더 필의 자리를 자식 창에서 도려낸다. `pill`은 **슬롯 콘텐츠 영역
/// 기준 상대 좌표**(물리 픽셀)이고, None이면 구멍을 없앤다.
///
/// 필을 드래그할 때마다 프론트엔드가 부른다. region은 자식 창을 실제로 자르므로,
/// 구멍 위치가 필과 어긋나면 VM 화면에 엉뚱한 사각 구멍이 뚫린 것처럼 보인다 —
/// 좌표 변환은 cutout_in_window 한 곳에만 두고 여기서 다른 식을 쓰지 말 것.
pub fn set_header_cutout(slot_id: &str, pill: Option<CutoutRect>) {
    let mut state = lock_state();
    let Some(info) = state.get_mut(slot_id) else { return };

    // 프론트가 보낸 필 사각형을 그대로 찍는다. "드래그가 DOM에서는 되는데 구멍이
    // 안 따라오는 것"과 "드래그 자체가 안 되는 것"은 화면상 똑같아 보이는데,
    // 이 값이 변하는지 여부로 한 번에 갈린다.
    dlog!("[cutout] slot={} pill={:?}", slot_id, pill);
    // **상대 좌표 그대로** 보관한다(변환은 apply_chrome_region이 적용 직전에 한다).
    if info.header_cutout == pill {
        return;
    }
    info.header_cutout = pill;

    if !info.is_visible {
        return;
    }
    let hwnd = HWND(info.child_hwnd as *mut _);
    if unsafe { IsWindow(hwnd) }.as_bool() {
        apply_chrome_region(hwnd, info.offset_x, info.offset, info.width, info.height, pill);
    }
}

pub fn update_position(slot_id: &str, x: i32, y: i32, width: i32, height: i32) {
    let mut state = lock_state();
    if let Some(info) = state.get_mut(slot_id) {
        // 좌표 계측. "우측 세션 레일이 VM에 덮인다"류의 버그는 원인이 셋으로
        // 갈리는데(프론트 측정이 틀림 / 백엔드가 적용을 안 함 / 애초에 호출이
        // 안 옴) 로그 없이는 구분이 안 된다. 들어온 값과 델타 필터 통과 여부를
        // 같이 남긴다. dev 빌드에서만 찍히고 %TEMP%\hyperdesk-swallow.log로 간다.
        dlog!(
            "[bounds] slot={} in=({},{} {}x{}) held=({},{} {}x{}) visible={}",
            slot_id, x, y, width, height,
            info.x, info.y, info.width, info.height, info.is_visible
        );
        // Delta filtering: Only update if there is at least >1px change to avoid jitter
        if (info.x - x).abs() <= 1 &&
           (info.y - y).abs() <= 1 &&
           (info.width - width).abs() <= 1 &&
           (info.height - height).abs() <= 1 {
            return;
        }

        info.x = x;
        info.y = y;
        info.width = width;
        info.height = height;
        
        if info.is_visible {
            unsafe {
                let hwnd = HWND(info.child_hwnd as *mut _);
                let p_hwnd = HWND(info.parent_hwnd as *mut _);
                
                if IsWindow(hwnd).as_bool() {
                    // Reuse the offsets resolved (and re-measured) at swallow time —
                    // NOT get_offset(class_name), which knows nothing about the
                    // per-window MEASURED chrome. Using the wrong one re-exposes the
                    // ribbon (or over-clips) on the very first resize after swallow.
                    let (tx, ty, tw, th) = framed_rect(x, y, width, height, info.offset_x, info.offset);

                    let mut rect = RECT::default();
                    if GetWindowRect(hwnd, &mut rect).is_ok() {
                        let mut pt_tl = POINT { x: rect.left, y: rect.top };
                        let _ = ScreenToClient(p_hwnd, &mut pt_tl);

                        // Precise filtering against the OFFSET-ADJUSTED target: only move
                        // on a real >1px change, so infinitesimal internal-render shifts
                        // can't ring the sync loop.
                        if (pt_tl.x - tx).abs() <= 1 &&
                           (pt_tl.y - ty).abs() <= 1 &&
                           ((rect.right - rect.left) - tw).abs() <= 1 &&
                           ((rect.bottom - rect.top) - th).abs() <= 1 {
                            return;
                        }
                    }

                    #[cfg(debug_assertions)]
                    eprintln!("[reposition] slot={} class='{}' -> {}x{} at ({},{})", slot_id, info.class_name, width, height, x, y);
                    // SYNCHRONOUS. The JS-side feedback loop is now cut by contain:strict
                    // on .slot-content-area, so the old reason for SWP_ASYNCWINDOWPOS (don't
                    // block on the child's pump while the loop rings) is gone. Async was
                    // actively harmful here: it POSTS the request, so during a layout
                    // transition several contradictory sizes (957x1042, 1918x501 — mixed
                    // half/full axes) could be in flight and the last POSTED one won, not
                    // the last CORRECT one — leaving mstsc parked off-slot. Synchronous
                    // makes the final call the authoritative geometry.
                    let _ = SetWindowPos(
                        hwnd,
                        HWND_TOP,
                        tx, ty, tw, th,
                        SWP_NOCOPYBITS | SWP_NOACTIVATE | SWP_NOOWNERZORDER
                    );

                    // Re-apply window region clipping to prevent child window from overflowing slot bounds
                    apply_chrome_region(hwnd, info.offset_x, info.offset, width, height, info.header_cutout);
                }
            }
        }
    }
}

// ─── Global keyboard hook: route Win-key / Alt+Tab into the focused VM ───────
//
// mstsc's own keyboardhook:i:1 forwarding half-works once the window is
// reparented: its foreground check compares against ITS top-level window, but
// after SetParent the foreground window is HyperDesk's — so mstsc forwards the
// key to the remote yet never suppresses the LOCAL shell → Win key opened the
// start menu on BOTH sides. This low-level hook closes that gap: while
// HyperDesk is foreground AND keyboard focus lives inside a swallowed child,
// Win/Alt+Tab events are eaten locally and posted straight to the focused
// child window instead. Any other focus state passes through untouched.
// (WH_KEYBOARD_LL is a message-based hook — this is NOT AttachThreadInput.)

static MAIN_HWND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn install_keyboard_hook(app: AppHandle, main_hwnd: isize) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowsHookExW, UnhookWindowsHookEx, SetTimer, GetMessageW, MSG, WH_KEYBOARD_LL, WM_TIMER,
    };
    let _ = APP_HANDLE.set(app);
    MAIN_HWND.store(main_hwnd, std::sync::atomic::Ordering::Relaxed);
    std::thread::spawn(|| unsafe {
        // LL hooks need a message pump on the installing thread.
        let mut hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(ll_keyboard_proc), None, 0) {
            Ok(h) => h,
            Err(_) => return,
        };
        dlog!("[keyhook] installed {:?}", hook.0);
        // 주기적 재설치. 두 가지를 동시에 막는다:
        //  (a) LL 훅 체인은 **가장 최근에 설치한 쪽이 먼저** 호출된다. 우리보다
        //      늦게 훅을 건 앱(원격 클라이언트는 키를 세션에 넘기려고 반드시 건다)이
        //      키를 먼저 먹으면 우리 프로시저는 **호출조차 안 된다** — 실측: Horizon
        //      슬롯에서 Alt+1~4를 눌러도 [keyhook] 로그가 한 줄도 안 찍혔다.
        //  (b) 프로시저가 LowLevelHooksTimeout(기본 300ms)을 넘기면 Windows가 훅을
        //      말없이 제거한다. 이후 모든 키 가로채기가 조용히 죽는다.
        // 둘 다 unhook → 재설치 한 방으로 복구되고, 재설치는 우리를 체인 맨 앞에 놓는다.
        // NULL hwnd로 건 타이머는 이 스레드 큐로 WM_TIMER를 보내므로 GetMessageW가 받는다.
        SetTimer(HWND(std::ptr::null_mut()), 1, 3000, None);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            if msg.message == WM_TIMER {
                let _ = UnhookWindowsHookEx(hook);
                match SetWindowsHookExW(WH_KEYBOARD_LL, Some(ll_keyboard_proc), None, 0) {
                    Ok(h) => hook = h,
                    // 재설치 실패는 되돌릴 방법이 없다 — 훅 없이 도는 것보다 로그를 남긴다.
                    Err(e) => { dlog!("[keyhook] REINSTALL FAILED: {e}"); return; }
                }
            }
        }
    });
}

// ─── 상단 호버 리빌은 제거됨 ────────────────────────────────────────────────
//
// 예전엔 몰입모드에서 헤더가 VM 아래에 깔려 있고, OS 커서 폴러가 화면 최상단을
// 감지하면 SetWindowRgn으로 VM 상단 띠를 잘라 헤더를 비췄다. 그 크롭이 열릴 때
// 보이는 검은 띠가 사용자가 지적한 "마우스 대면 내려오는 검정 배경"이었다.
//
// 이제 헤더 필은 set_header_cutout이 자기 사각형만큼 자식 창에 **항상** 구멍을
// 뚫어 띄우므로 띠도, 커서 폴링도 필요 없다. REVEAL_BAND / apply_reveal /
// set_reveal_band_px / flash_immersive_header를 되살리지 말 것 — 구멍과 띠가
// 같은 region을 두고 싸운다. 몰입모드의 전체화면 전환은 commands::apply_fullscreen이
// 그대로 담당한다.

/// Every distinct thread that owns a window in `frame`'s tree. mstsc keeps its
/// input window on a different thread than the shell frame, so checking only
/// the frame's thread misses the real focus holder.
fn tree_thread_ids(frame: HWND) -> Vec<u32> {
    struct P { tids: Vec<u32> }
    extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let p = unsafe { &mut *(lparam.0 as *mut P) };
        let tid = unsafe { GetWindowThreadProcessId(hwnd, None) };
        if tid != 0 && !p.tids.contains(&tid) { p.tids.push(tid); }
        BOOL::from(true)
    }
    let mut p = P { tids: Vec::new() };
    let ftid = unsafe { GetWindowThreadProcessId(frame, None) };
    if ftid != 0 { p.tids.push(ftid); }
    unsafe {
        let _ = EnumChildWindows(frame, Some(cb), LPARAM(&mut p as *mut P as isize));
    }
    p.tids
}

/// The window that should receive VM-bound system keys: a focus window inside a
/// visible swallowed child's tree — but only while HyperDesk itself is foreground.
/// HyperDesk 본체가 포그라운드인가. 슬롯 전환 키를 가로챌지 판단하는 기준이다 —
/// 포커스가 swallow된 자식 어디에 있든(또는 자식 트리 밖의 별도 스레드에 있든)
/// 창 자체가 앞에 있으면 Alt+1~4는 우리 것이다.
/// LL 훅이 볼 슬롯 전환 수정자. 0=Alt, 1=Ctrl, 2=Shift, 3=Win.
/// 전역 단축키 등록(lib.rs)과 **같은 값**이어야 한다 — 어긋나면 훅이 옛 조합을
/// 가로채서 새 조합은 원격으로 새고 옛 조합은 먹히는 이상한 상태가 된다.
static HOTKEY_MOD_CODE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

pub fn set_hotkey_modifier(m: &str) {
    let v = match m {
        "ctrl" => 1u8,
        "shift" => 2,
        "super" => 3,
        _ => 0,
    };
    HOTKEY_MOD_CODE.store(v, std::sync::atomic::Ordering::Relaxed);
}

/// 지금 눌려 있는 키들이 설정된 수정자와 맞는가.
fn hotkey_mod_down(alt_down: bool) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_SHIFT, VK_LWIN, VK_RWIN};
    let down = |vk: i32| unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 };
    match HOTKEY_MOD_CODE.load(std::sync::atomic::Ordering::Relaxed) {
        1 => down(VK_CONTROL.0 as i32),
        2 => down(VK_SHIFT.0 as i32),
        3 => down(VK_LWIN.0 as i32) || down(VK_RWIN.0 as i32),
        // Alt는 훅이 주는 플래그가 가장 정확하다(GetAsyncKeyState는 놓칠 수 있다).
        _ => alt_down,
    }
}

fn app_is_foreground() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsChild};
    let main = MAIN_HWND.load(std::sync::atomic::Ordering::Relaxed);
    if main == 0 { return false; }
    let main_h = HWND(main as *mut _);
    unsafe {
        let fg = GetForegroundWindow();
        // 포그라운드가 본체이거나, 본체 안에 들어앉은 창(swallow된 자식 포함)이면 참.
        fg.0 as isize == main || IsChild(main_h, fg).as_bool()
    }
}

fn vm_key_target() -> Option<HWND> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetGUIThreadInfo, GUITHREADINFO, IsChild};
    let main = MAIN_HWND.load(std::sync::atomic::Ordering::Relaxed);
    if main == 0 { return None; }
    unsafe {
        if GetForegroundWindow().0 as isize != main {
            return None;
        }
        let children: Vec<isize> = lock_state().values()
            .filter(|i| i.is_visible)
            .map(|i| i.child_hwnd)
            .collect();
        for raw in children {
            let child = HWND(raw as *mut _);
            if !IsWindow(child).as_bool() { continue; }
            for tid in tree_thread_ids(child) {
                let mut gui = GUITHREADINFO { cbSize: std::mem::size_of::<GUITHREADINFO>() as u32, ..Default::default() };
                if GetGUIThreadInfo(tid, &mut gui).is_err() || gui.hwndFocus.is_invalid() {
                    continue;
                }
                // The focus must actually live inside THIS swallowed tree —
                // GetGUIThreadInfo reports a thread's focus even when that
                // thread isn't the active one, so an unguarded match could
                // route keys to a stale window.
                if gui.hwndFocus.0 == child.0 || IsChild(child, gui.hwndFocus).as_bool() {
                    #[cfg(debug_assertions)]
                    dlog!("[keyhook] target hwnd={:?} (tid {}) in child {:?}", gui.hwndFocus.0, tid, child.0);
                    return Some(gui.hwndFocus);
                }
            }
        }
        #[cfg(debug_assertions)]
        dlog!("[keyhook] foreground OK but no swallowed tree holds focus");
    }
    None
}

unsafe extern "system" fn ll_keyboard_proc(code: i32, wparam: windows::Win32::Foundation::WPARAM, lparam: LPARAM) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, PostMessageW, KBDLLHOOKSTRUCT, HC_ACTION,
        LLKHF_INJECTED, LLKHF_UP, LLKHF_EXTENDED, LLKHF_ALTDOWN,
        WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_LWIN, VK_RWIN, VK_TAB};

    if code == HC_ACTION as i32 {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let injected = kb.flags.0 & LLKHF_INJECTED.0 != 0;
        let alt_down = kb.flags.0 & LLKHF_ALTDOWN.0 != 0;
        let is_win = kb.vkCode == VK_LWIN.0 as u32 || kb.vkCode == VK_RWIN.0 as u32;
        let is_alt_tab = kb.vkCode == VK_TAB.0 as u32 && alt_down;
        // Alt+1..4 (slot switching) must keep working while a VM holds focus —
        // with keyboardhook:i:1 the remote would otherwise swallow them.
        let is_slot_key = hotkey_mod_down(alt_down) && (0x31..=0x34).contains(&kb.vkCode);

        if !injected && is_slot_key {
            let up = kb.flags.0 & LLKHF_UP.0 != 0;
            // 슬롯 키를 **우리 훅이 보기는 하는지** 남긴다. 안 찍히면 다른 앱(Horizon)이
            // 훅 체인에서 우리보다 먼저 가로채 소비한 것이고, 찍히는데 fg=false면
            // 포그라운드 판정이 문제다 — 둘은 고치는 방법이 완전히 다르다.
            if !up {
                dlog!("[keyhook] slot key vk={} seen, app_foreground={}",
                    kb.vkCode - 0x30, app_is_foreground());
            }
            // **포그라운드가 우리면 슬롯 키는 우리 것이다.** 예전엔 vm_key_target()이
            // Some일 때만(= 포커스가 swallow된 자식 트리 안일 때만) 가로챘는데,
            // Omnissa/Horizon은 포커스 토폴로지가 달라 그 검사를 통과하지 못해
            // Alt+1~4가 원격으로 넘어가 버렸다(실측: Horizon 슬롯에서 [keyhook]
            // target 줄이 아예 안 찍힘). 어떤 앱이 어떤 식으로 포커스를 잡든
            // "HyperDesk가 포그라운드"면 슬롯 전환은 우리가 처리하는 게 맞다.
            if app_is_foreground() {
                if !up {
                    let idx = kb.vkCode - 0x31;
                    // Off-thread: app.emit serializes into the webview; the hook
                    // callback must return fast (system LL-hook timeout).
                    std::thread::spawn(move || {
                        if let Some(app) = APP_HANDLE.get() {
                            let slot = format!("slot-{}", idx);
                            let _ = app.emit("hotkey-focus", slot.clone());
                            focus_window(&slot);
                        }
                    });
                }
                return LRESULT(1); // keep it away from both the remote and RegisterHotKey
            }
        }

        if !injected && (is_win || is_alt_tab) {
            if let Some(target) = vm_key_target() {
                let up = kb.flags.0 & LLKHF_UP.0 != 0;
                // Rebuild the WM_KEY* lparam: repeat=1, scancode, extended,
                // and for keyup the previous-state + transition bits.
                let mut l: isize = 1 | (((kb.scanCode & 0xFF) as isize) << 16);
                if kb.flags.0 & LLKHF_EXTENDED.0 != 0 { l |= 1 << 24; }
                if up { l |= (1 << 30) | (1 << 31); }
                let msg = if is_alt_tab {
                    l |= 1 << 29; // context bit: Alt is held
                    if up { WM_SYSKEYUP } else { WM_SYSKEYDOWN }
                } else if up { WM_KEYUP } else { WM_KEYDOWN };
                let _ = PostMessageW(target, msg,
                    windows::Win32::Foundation::WPARAM(kb.vkCode as usize), LPARAM(l));
                return LRESULT(1); // eaten locally — host shell never reacts
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

/// Forward keyboard focus to a swallowed window by slot ID.
/// Called from hotkey handlers and the focus_slot_window command.
pub fn focus_window(slot_id: &str) {
    let (hwnd_raw, vmconnect_pid) = {
        let state = lock_state();
        match state.get(slot_id) {
            Some(info) => (Some(info.child_hwnd), info.vmconnect_pid),
            None => (None, None),
        }
    };
    if let Some(raw) = hwnd_raw {
        let hwnd = HWND(raw as *mut _);
        unsafe {
            if IsWindow(hwnd).as_bool() {
                let _ = SetForegroundWindow(hwnd);
                let _ = BringWindowToTop(hwnd);
            }
        }
        // vmconnect re-creates its connect-bar on focus; the stabilization loop
        // also re-hides it but only polls at 1s when idle — do it here immediately.
        if let Some(pid) = vmconnect_pid {
            hide_vmconnect_bbar(pid);
        }
        // SetForegroundWindow above targets a swallowed CHILD owned by a foreign
        // process (mstsc/vmconnect) — same as an Alt+Tab round-trip, which is
        // exactly what makes the shell drop the fullscreen taskbar exemption
        // (see mark_fullscreen_native). Alt+1~4 slot-switch focus hits this same
        // path, so it needs the same re-mark, not just Alt+Tab.
        if FULLSCREEN_ACTIVE.load(std::sync::atomic::Ordering::Relaxed) {
            let main = HWND(MAIN_HWND.load(std::sync::atomic::Ordering::Relaxed) as *mut _);
            if !main.0.is_null() {
                mark_fullscreen_native(main, true);
            }
        }
    }
}

static FULLSCREEN_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Tracks OS-fullscreen state (set by commands::apply_fullscreen) so
/// focus_window knows whether a re-mark is needed.
pub fn set_fullscreen_active(on: bool) {
    FULLSCREEN_ACTIVE.store(on, std::sync::atomic::Ordering::Relaxed);
}

/// ITaskbarList2::MarkFullscreenWindow on the main window. Single-sourced here
/// so both commands::apply_fullscreen (enter/exit) and focus_window (slot
/// switch, see above) can re-assert it — best-effort: on failure the
/// geometric fullscreen detection still applies.
pub fn mark_fullscreen_native(hwnd: HWND, on: bool) {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{ITaskbarList2, TaskbarList};
    unsafe {
        // Tauri commands/hotkey handlers run on worker threads with no
        // guaranteed COM state. Per-thread init is idempotent (RPC_E_CHANGED_MODE
        // == already up, fine).
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if let Ok(tb) = CoCreateInstance::<_, ITaskbarList2>(&TaskbarList, None, CLSCTX_INPROC_SERVER) {
            let _ = tb.HrInit();
            let _ = tb.MarkFullscreenWindow(hwnd, BOOL::from(on));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{framed_rect, chrome_region_rect, title_match_better, BOTTOM_BIAS, HORIZONTAL_BUFFER};

    // ── vmconnect console window selection (ground-truthed via live probe
    // 2026-07-21 against VM "Windows 10 MSIX packaging environment") ──────────
    //
    // Two visible top-level windows carry the VM name in their title:
    //   1. "<VM>에 연결"                         — transient progress, 477x224
    //   2. "<host>의 <VM> - 가상 컴퓨터 연결"     — the console frame, 650x508
    // The hunt must land on #2. Selection is by LARGEST title-matching area, so
    // it's locale-independent (no reliance on the " - 가상 컴퓨터 연결" suffix).

    /// Simulates the callback's accumulation over an EnumWindows pass: folds the
    /// window list, keeping the hwnd-index whose title matches and area is max.
    fn pick_best(windows: &[(&str, i64)], needle: &str) -> Option<usize> {
        let needle = needle.to_lowercase();
        let mut best_area = 0i64;
        let mut best_idx = None;
        for (i, (title, area)) in windows.iter().enumerate() {
            if let Some(nb) = title_match_better(title, &needle, *area, best_area) {
                best_area = nb;
                best_idx = Some(i);
            }
        }
        best_idx
    }

    #[test]
    fn vmconnect_picks_console_over_connecting_popup() {
        let vm = "Windows 10 MSIX packaging environment";
        let windows = [
            ("Windows 10 MSIX packaging environment에 연결", 477 * 224),
            ("localhost의 Windows 10 MSIX packaging environment - 가상 컴퓨터 연결", 650 * 508),
        ];
        // Regardless of enumeration order, the larger console frame wins.
        assert_eq!(pick_best(&windows, vm), Some(1));
        let mut rev = windows;
        rev.reverse();
        assert_eq!(pick_best(&rev, vm), Some(0)); // console is now index 0
    }

    #[test]
    fn vmconnect_title_gate_rejects_unrelated_and_usage_dialog() {
        let vm = "Ubuntu 20.04 LTS";
        let windows = [
            ("가상 컴퓨터 연결 사용", 500 * 300),          // vmconnect usage/error dialog — no VM name
            ("localhost의 SAP_B1_9.3 - 가상 컴퓨터 연결", 650 * 508), // a DIFFERENT VM's console
            ("Program Manager", 1920 * 1080),               // huge unrelated window
        ];
        // None contains "ubuntu 20.04 lts" → no match, hunt keeps polling.
        assert_eq!(pick_best(&windows, vm), None);
    }

    #[test]
    fn vmconnect_case_insensitive_and_substring() {
        // The needle is a substring of a longer localized title, any case.
        assert!(title_match_better("LOCALHOST의 MyVM - 가상 컴퓨터 연결", "myvm", 100, 0).is_some());
        // Not larger than current best → not chosen even though it matches.
        assert!(title_match_better("MyVM console", "myvm", 100, 100).is_none());
    }

    /// REGRESSION (2026-08-26, "로컬에 열어둔 mstsc가 슬롯에 빨려들어가 끊김"):
    /// `find_main_window`의 PID-less 2차 패스는 title needle이 **없으면** 절대
    /// 돌면 안 된다 — 우리 mstsc인지 사용자가 직접 띄운 세션인지 클래스만으로는
    /// 구분 못 한다. 진짜 `TscShellContainerClass` 창(mstsc의 실제 클래스명)을
    /// 등록해, 2차 패스가 돌았다면 확실히 찾혔을 상황을 만든 뒤 그래도 못 찾는지
    /// 확인한다.
    #[test]
    fn find_main_window_never_falls_back_without_a_title_needle() {
        use windows::core::w;
        use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassW, UnregisterClassW,
            CS_HREDRAW, CS_VREDRAW, HMENU, WINDOW_EX_STYLE, WNDCLASSW,
            WS_OVERLAPPEDWINDOW, WS_VISIBLE,
        };
        use super::find_main_window;

        unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
            unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
        }

        unsafe {
            let hinstance = HINSTANCE::default(); // same-process 등록엔 널로 충분
            let class_name = w!("TscShellContainerClass"); // 실제 mstsc 세션 프레임 클래스명
            let wc = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(wndproc),
                hInstance: hinstance,
                lpszClassName: class_name,
                ..Default::default()
            };
            let atom = RegisterClassW(&wc);
            assert_ne!(atom, 0, "RegisterClassW failed — cannot set up the regression fixture");

            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0), class_name, w!("someone else's RDP session"),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                0, 0, 400, 300, HWND::default(), HMENU::default(), hinstance, None,
            ).expect("create probe window");

            // 우리 hunt 루프가 절대 안 쓸 가짜 PID — 1차(PID 스코프) 패스는 확실히 빈손.
            let bogus_pid = 0xFFFF_FFFEu32;
            let found = find_main_window(bogus_pid, None);

            let _ = DestroyWindow(hwnd);
            let _ = UnregisterClassW(class_name, hinstance);

            assert!(
                found.is_none(),
                "needle 없이 시스템 전체를 훑는 2차 패스가 다시 돌면, 방금 만든 남의                  TscShellContainerClass 창을 우리 세션으로 착각해 슬롯에 빨아들인다 —                  그러면 unswallow가 그 창에 WM_CLOSE를 보내 남의 RDP 세션이 끊긴다."
            );
        }
    }

    /// Horizon 멀티뷰의 핵심 동작: 렌더 서피스(`MKSEmbedded`)를 **화면 좌표로 준
    /// 목표**에 정확히 놓는가. 이 서피스는 WS_CHILD라 SetWindowPos가 부모-클라이언트
    /// 기준인데, 라이브 프로브를 만들 때 이 변환을 빼먹으면 부모 원점이 (0,0)이 아닌
    /// 순간 그대로 어긋난다(그 시절 C# 초안이 정확히 이 함정에 걸렸다). 부모를 일부러
    /// (0,0)이 아닌 자리에 놓고, 그래도 서피스가 목표 화면 좌표에 오는지 확인한다.
    #[test]
    fn horizon_surface_lands_on_the_target_in_screen_coords() {
        use windows::core::w;
        use windows::Win32::Foundation::{HINSTANCE, HWND, RECT};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetWindowRect, HMENU, WINDOW_EX_STYLE,
            WS_CHILD, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
        };
        use super::sync_horizon_surface;

        unsafe {
            // frame ─ mid(원점이 (0,0)이 아니게 일부러 오프셋) ─ MKSEmbedded
            let frame = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("hz-frame"), WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                40, 60, 900, 700, HWND::default(), HMENU::default(), HINSTANCE::default(), None,
            ).expect("frame");
            let mid = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("hz-mid"), WS_CHILD | WS_VISIBLE,
                37, 23, 800, 600, frame, HMENU::default(), HINSTANCE::default(), None,
            ).expect("mid");
            // 실제 클래스명은 못 만들지만(시스템 클래스만 사용 가능), 찾기는 클래스명
            // 부분일치이므로 창 클래스 대신 이름이 같은 STATIC을 쓰면 find가 못 찾는다.
            // → 이 테스트는 좌표 변환만 검증하므로 surface를 직접 만들어 두고
            //   sync_horizon_surface가 쓰는 것과 동일한 변환식을 적용한 결과를 비교한다.
            let surface = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("hz-surface"), WS_CHILD | WS_VISIBLE,
                0, 0, 100, 100, mid, HMENU::default(), HINSTANCE::default(), None,
            ).expect("surface");

            // sync_horizon_surface와 같은 변환을 손으로 재현해 적용한다.
            let target = RECT { left: 300, top: 250, right: 300 + 640, bottom: 250 + 480 };
            {
                use windows::Win32::Foundation::POINT;
                use windows::Win32::Graphics::Gdi::ScreenToClient;
                use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW};
                let mut tl = POINT { x: target.left, y: target.top };
                let _ = ScreenToClient(mid, &mut tl);
                let _ = SetWindowPos(surface, HWND(std::ptr::null_mut()), tl.x, tl.y,
                    target.right - target.left, target.bottom - target.top,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOZORDER);
            }

            let mut got = RECT::default();
            GetWindowRect(surface, &mut got).expect("surface rect");

            let _ = DestroyWindow(surface);
            let _ = DestroyWindow(mid);
            let _ = DestroyWindow(frame);

            assert_eq!(
                (got.left, got.top, got.right - got.left, got.bottom - got.top),
                (300, 250, 640, 480),
                "ScreenToClient 변환이 빠지면 부모 원점만큼 어긋난다 — Horizon 임베드가                  슬롯에서 밀려나는 정확한 원인이다"
            );

            // 실제 함수는 MKSEmbedded 클래스를 못 찾으면 조용히 false를 준다.
            assert!(!sync_horizon_surface(frame, target),
                "MKSEmbedded가 없는 트리에서는 아무것도 하지 않아야 한다");
        }
    }

    /// REGRESSION (2026-09-03): 위치 보정은 **크기를 절대 바꾸면 안 된다**.
    ///
    /// Horizon 데스크톱 프레임은 SetParent 전 화면 좌표를 그대로 들고 있어 부모 기준
    /// 으로 재해석되면 화면 밖으로 튄다(실측: at=(1920,0) want=(223,40) → 화면 3840).
    /// 그래서 위치 보정은 꼭 필요하다. 반대로 **크기** 강제는 폭풍을 만든다 — mstsc는
    /// 세션 해상도/작업영역 아래로 안 줄어들어서 매 폴 되돌려도 튕겨내고(실측 400회+),
    /// 살아있는 세션에 WM_SIZE만 퍼붓는다. 그래서 SWP_NOSIZE로 위치만 옮긴다.
    /// 이 테스트는 그 플래그가 실제로 크기를 보존하는지 실제 창으로 고정한다.
    #[test]
    fn position_only_move_preserves_size() {
        use windows::core::w;
        use windows::Win32::Foundation::{HINSTANCE, HWND, RECT};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetWindowRect, SetWindowPos, HMENU,
            SWP_NOACTIVATE, SWP_NOSIZE, SWP_SHOWWINDOW, WINDOW_EX_STYLE,
            WS_CHILD, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
        };
        unsafe {
            let parent = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("p"), WS_OVERLAPPEDWINDOW,
                0, 0, 1200, 900, HWND::default(), HMENU::default(), HINSTANCE::default(), None,
            ).expect("parent");
            let child = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("c"), WS_CHILD | WS_VISIBLE,
                700, 500, 640, 480, parent, HMENU::default(), HINSTANCE::default(), None,
            ).expect("child");

            // 위치만 옮긴다 — 크기 인자는 0으로 줘도 SWP_NOSIZE면 무시돼야 한다.
            let _ = SetWindowPos(child, HWND::default(), 10, 20, 0, 0,
                SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE);

            let mut r = RECT::default();
            GetWindowRect(child, &mut r).expect("rect");
            let mut pr = RECT::default();
            GetWindowRect(parent, &mut pr).expect("parent rect");

            let _ = DestroyWindow(child);
            let _ = DestroyWindow(parent);

            assert_eq!(
                (r.right - r.left, r.bottom - r.top), (640, 480),
                "SWP_NOSIZE인데 크기가 바뀌면 위치 보정이 리사이즈 폭풍으로 되돌아간다"
            );
        }
    }

    /// REGRESSION (2026-09-02): a swallowed FRAME that has drifted to a tiny rect must
    /// be reported as collapsed. The old check only measured the frame's FIRST CHILD,
    /// and live dlog showed the exact case that defeats it — frame at
    /// `(-31769,-31956) 8x8` while its child was still a healthy `1920x1080`, so the
    /// check answered "surface OK" and no recovery ever ran. If the frame is collapsed
    /// nothing inside it can be visible, whatever the children measure.
    #[test]
    fn a_collapsed_frame_counts_as_collapsed_even_with_a_healthy_child() {
        use windows::core::w;
        use windows::Win32::Foundation::{HINSTANCE, HWND};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, HMENU, WINDOW_EX_STYLE,
            WS_CHILD, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
        };
        use super::child_surface_collapsed;

        unsafe {
            // 실제 구조 그대로: 컨테이너 안에 WS_CHILD 프레임(8x8) + 그 안에 멀쩡한
            // 1920x1080 자식. WS_OVERLAPPEDWINDOW로 만들면 Windows가 캡션/테두리
            // 때문에 최소 크기를 강제해서 8x8이 안 된다 — swallow된 프레임은 어차피
            // SetParent 후 WS_CHILD이므로 이쪽이 현실과도 맞다.
            let container = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("container"), WS_OVERLAPPEDWINDOW,
                0, 0, 1920, 1080, HWND::default(), HMENU::default(), HINSTANCE::default(), None,
            ).expect("create container");
            let frame = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("tiny-frame"), WS_CHILD | WS_VISIBLE,
                0, 0, 8, 8, container, HMENU::default(), HINSTANCE::default(), None,
            ).expect("create frame");
            let child = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("healthy-child"), WS_CHILD | WS_VISIBLE,
                0, 0, 1920, 1080, frame, HMENU::default(), HINSTANCE::default(), None,
            ).expect("create child");

            let collapsed = child_surface_collapsed(frame);

            let _ = DestroyWindow(child);
            let _ = DestroyWindow(frame);
            let _ = DestroyWindow(container);

            assert!(
                collapsed,
                "프레임이 8x8이면 자식이 아무리 멀쩡해도 화면엔 아무것도 안 보인다 —                  자식만 재던 옛 판정이 이 케이스를 통과시켜서 검은 화면이 안 고쳐졌다"
            );
        }
    }

    /// REGRESSION (2026-09-02): the load-bearing premise of the iconic-restore fix —
    /// **Windows ignores SetWindowPos on a minimized window**, parking it at ~-32000
    /// regardless of the rect asked for. That is why the 1px nudge alone could never
    /// un-collapse a swallowed session: live dlog showed the child tree pinned at
    /// (-31769,-31956) 8x8 through six consecutive nudges with the coordinates never
    /// moving a single pixel. ShowWindow(SW_SHOWNOACTIVATE) first is what makes the
    /// subsequent SetWindowPos mean anything. If this ever stops holding, the
    /// ShowWindow call in recover_collapsed_surface is dead weight.
    #[test]
    fn setwindowpos_is_ignored_while_a_window_is_minimized() {
        use windows::core::w;
        use windows::Win32::Foundation::{HINSTANCE, HWND, RECT};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetWindowRect, IsIconic, SetWindowPos, ShowWindow,
            HMENU, SWP_NOACTIVATE, SWP_NOZORDER, SW_MINIMIZE, SW_SHOWNOACTIVATE,
            WINDOW_EX_STYLE, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
        };

        unsafe {
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("hyperdesk-iconic-probe"),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                100, 100, 400, 300, HWND::default(), HMENU::default(), HINSTANCE::default(), None,
            ).expect("create probe window");

            let _ = ShowWindow(hwnd, SW_MINIMIZE);
            assert!(IsIconic(hwnd).as_bool(), "sanity: probe should be minimized");

            // 최소화 상태에서 옮겨본다 — 무시돼야 한다.
            let _ = SetWindowPos(hwnd, HWND(std::ptr::null_mut()), 300, 200, 800, 600,
                SWP_NOZORDER | SWP_NOACTIVATE);
            let mut while_min = RECT::default();
            GetWindowRect(hwnd, &mut while_min).expect("rect while minimized");

            // 복원한 뒤 같은 요청 — 이번엔 먹혀야 한다.
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            let _ = SetWindowPos(hwnd, HWND(std::ptr::null_mut()), 300, 200, 800, 600,
                SWP_NOZORDER | SWP_NOACTIVATE);
            let mut after_restore = RECT::default();
            GetWindowRect(hwnd, &mut after_restore).expect("rect after restore");

            let _ = DestroyWindow(hwnd);

            assert!(
                while_min.left < -10000 && while_min.top < -10000,
                "최소화된 창은 SetWindowPos를 무시하고 주차 좌표에 머물러야 한다                  (실측 got {},{}) — 이게 아니면 넛지가 안 먹힌 원인 분석이 틀린 것이다",
                while_min.left, while_min.top
            );
            assert_eq!(
                (after_restore.left, after_restore.top), (300, 200),
                "복원 뒤에는 같은 SetWindowPos가 먹혀야 한다"
            );
        }
    }

    /// Pins the load-bearing premise of the minimize black-screen fix (2026-08-25):
    /// a minimized window's CLIENT rect really does collapse to 0×0. WebView2 sizes
    /// the page to that rect, so `.slot-content-area`'s getBoundingClientRect() goes
    /// to 0 and SwallowSlot's syncBounds would push 0×0 down to a live mstsc session
    /// — hence the `nextW < 2 || nextH < 2` guard there. If this ever stops holding,
    /// that guard is dead code and the real cause is elsewhere.
    #[test]
    fn minimizing_collapses_the_client_rect_to_zero() {
        use windows::core::w;
        use windows::Win32::Foundation::{HINSTANCE, HWND, RECT};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetClientRect, HMENU, ShowWindow,
            SW_MINIMIZE, SW_RESTORE, WINDOW_EX_STYLE, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
        };

        unsafe {
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("hyperdesk-minimize-probe"),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                0, 0, 800, 600, HWND::default(), HMENU::default(), HINSTANCE::default(), None,
            ).expect("create probe window");

            let mut before = RECT::default();
            GetClientRect(hwnd, &mut before).expect("client rect before");

            let _ = ShowWindow(hwnd, SW_MINIMIZE);
            let mut mini = RECT::default();
            GetClientRect(hwnd, &mut mini).expect("client rect while minimized");

            let _ = ShowWindow(hwnd, SW_RESTORE);
            let mut after = RECT::default();
            GetClientRect(hwnd, &mut after).expect("client rect after restore");

            let _ = DestroyWindow(hwnd);

            assert!(before.right > 0 && before.bottom > 0, "sanity: window had a real client area");
            assert_eq!(
                (mini.right, mini.bottom), (0, 0),
                "minimized client rect must be 0x0 — this is what collapses the WebView2 \
                 page and makes syncBounds measure 0"
            );
            assert!(after.right > 0 && after.bottom > 0, "restore brings the client area back");
        }
    }

    /// REGRESSION (2026-08-25, "슬롯 전환시 RDP 원격 작업표시줄이 잘림"): a slot
    /// that GROWS while hidden must come back with its clip region matching the
    /// new size, not the size it had when it was hidden.
    ///
    /// Real Win32 windows, because the bug is a call-ordering one — `update_position`
    /// writes the new bounds into SWALLOW_STATE and only THEN checks `is_visible`,
    /// so the stored size advances while the region does not. Pure geometry can't
    /// see that; only the actual GetWindowRgnBox vs GetWindowRect comparison can.
    /// Removing the `apply_chrome_region` call from `set_visibility(true)` makes
    /// this fail with a region 400px short at the bottom (= the clipped-off strip
    /// where the remote desktop's taskbar lives).
    #[test]
    fn hidden_slot_that_grows_comes_back_with_a_matching_region() {
        use windows::core::w;
        use windows::Win32::Foundation::{HINSTANCE, HWND, RECT};
        use windows::Win32::Graphics::Gdi::GetWindowRgnBox;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetWindowRect, HMENU,
            WINDOW_EX_STYLE, WS_CHILD, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
        };
        use super::{apply_chrome_region, lock_state, set_visibility, update_position, SwallowInfo};

        const SLOT: &str = "test-slot-regrow";
        let (small_w, small_h) = (800, 600);
        let (big_w, big_h) = (1600, 1000);

        unsafe {
            // "STATIC" is a pre-registered system class — no RegisterClassW needed.
            let parent = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("parent"), WS_OVERLAPPEDWINDOW,
                0, 0, 1920, 1080, HWND::default(), HMENU::default(), HINSTANCE::default(), None,
            ).expect("create parent");
            let child = CreateWindowExW(
                WINDOW_EX_STYLE(0), w!("STATIC"), w!("child"), WS_CHILD | WS_VISIBLE,
                0, 0, small_w, small_h, parent, HMENU::default(), HINSTANCE::default(), None,
            ).expect("create child");

            // Stand in for a completed swallow at the SMALL size. RDP-shaped:
            // offset/offset_x are 0, so the region is exactly the slot rect —
            // which is why RDP (not vmconnect, whose stabilization loop re-applies
            // its region every poll) is the one that showed this bug.
            lock_state().insert(SLOT.to_string(), SwallowInfo {
                child_hwnd: child.0 as isize,
                original_style: 0, original_ex_style: 0,
                original_parent: parent.0 as isize,
                x: 0, y: 0, width: small_w, height: small_h,
                parent_hwnd: parent.0 as isize,
                is_visible: true,
                class_name: "STATIC".to_string(),
                offset: 0, offset_x: 0,
                vmconnect_pid: None,
                // A cutout must be present or apply_chrome_region clears the region
                // entirely for an RDP-shaped window — the floating header pill is
                // always cut out of a live session, so this matches reality.
                header_cutout: Some((10, 0, 210, 36)),
            });
            apply_chrome_region(child, 0, 0, small_w, small_h, Some((10, 0, 210, 36)));

            // Slot switches away…
            set_visibility(SLOT, false).unwrap();
            // …and while it is hidden the layout grows (fullscreen/immersive enter,
            // window resize, another slot's rail unmounting). update_position stores
            // the new bounds but skips applying them — this is the gap.
            update_position(SLOT, 0, 0, big_w, big_h);
            // …then the user switches back.
            set_visibility(SLOT, true).unwrap();

            let mut wr = RECT::default();
            GetWindowRect(child, &mut wr).expect("GetWindowRect");
            let mut rgn = RECT::default();
            let rgn_ok = GetWindowRgnBox(child, &mut rgn).0 != 0; // 0 == RGN_ERROR (no region)

            let _ = DestroyWindow(child);
            let _ = DestroyWindow(parent);
            lock_state().remove(SLOT);

            let win_h = wr.bottom - wr.top;
            let win_w = wr.right - wr.left;
            // 창 높이는 BOTTOM_BIAS만큼 더 크다(그만큼 위로 올라가 있고, region이
            // 같은 값만큼 내려가서 슬롯은 정확히 덮인다 — 아래 region 검사가 그걸 본다).
            assert_eq!((win_w, win_h), (big_w, big_h + super::BOTTOM_BIAS),
                "window itself should be at the grown size (plus the bottom bias)");
            assert!(rgn_ok, "a region should still be set");
            assert_eq!(
                (rgn.right, rgn.bottom), (big_w, big_h + super::BOTTOM_BIAS),
                "clip region must cover the whole grown window; a short bottom is \
                 exactly the strip where the remote desktop's taskbar gets eaten"
            );
        }
    }


    // The invariant that fixes the white-border bug: the swallowed frame is
    // positioned/sized so the CONTENT (client area, inset by the symmetric
    // non-client border on every side) exactly fills the slot. With a border of
    // `b` on all sides and a top ribbon `ribbon`, offset_x = b and offset =
    // b + ribbon. Then: window origin = slot - (offset_x, offset), window size
    // must cover slot + border on the far sides too.
    #[test]
    fn framed_rect_rdp_is_slot_identity() {
        // RDP/Horizon: no chrome → frame == slot exactly (no white border work).
        // BOTTOM_BIAS만큼 위로 올리고 높이를 그만큼 늘린다 — 슬롯은 그대로 덮이고
        // 보이는 구간만 아래로 이동한다(원격 작업표시줄 하단이 잘리지 않게).
        assert_eq!(framed_rect(100, 50, 1918, 1077, 0, 0),
            (100, 50 - BOTTOM_BIAS, 1918, 1077 + BOTTOM_BIAS));
    }

    #[test]
    fn framed_rect_enhanced_session_covers_all_four_borders() {
        // Enhanced vmconnect: symmetric 2px non-client border, no ribbon.
        // offset_x = 2, offset = 2. Content must fill the whole slot.
        let (x, y, w, h) = framed_rect(100, 50, 1918, 1077, 2, 2);
        assert_eq!((x, y), (98, 48 - BOTTOM_BIAS)); // border만큼 좌상 이동 + 하단 바이어스
        // width/height grow by the border on BOTH sides (this is the exact fix
        // for the right/bottom 2px white edge).
        assert_eq!(w, 1918 + 4);
        assert_eq!(h, 1077 + 4 + BOTTOM_BIAS);
        // Client area = window minus border on all sides == the slot.
        let border = 2;
        assert_eq!(w - 2 * border, 1918);
        assert_eq!(h - 2 * border - BOTTOM_BIAS, 1077);
        // And the client's top-left lands exactly on the slot origin.
        assert_eq!(x + border, 100);
        assert_eq!(y + border + BOTTOM_BIAS, 50);
    }

    #[test]
    fn framed_rect_basic_session_ribbon_only_shifts_top() {
        // Basic vmconnect: 2px border + 51px ribbon. offset_x=2, offset=53.
        // Bottom border is just the 2px (offset_x), NOT offset — the ribbon is
        // top-only. This is why height adds `offset + offset_x`, not `2*offset`.
        let (x, y, w, h) = framed_rect(0, 0, 1000, 800, 2, 53);
        assert_eq!(x, -2);
        assert_eq!(y, -53 - BOTTOM_BIAS);
        assert_eq!(w, 1000 + 4);      // left+right border
        assert_eq!(h, 800 + 53 + 2 + BOTTOM_BIAS);
    }

    #[test]
    fn chrome_region_none_when_nothing_to_clip() {
        // BOTTOM_BIAS가 생긴 뒤로는 크롬이 없어도 **항상** 자를 게 있다(바이어스만큼
        // 아래로 옮겨야 하므로). 예전엔 이 경우 None으로 region을 지웠다.
        let r = chrome_region_rect(0, 0, 0, 1918, 1077).unwrap();
        assert_eq!(r.1, BOTTOM_BIAS);            // 보이는 구간이 바이어스만큼 내려감
        assert_eq!(r.3 - r.1, 1077);             // 그래도 슬롯 높이는 그대로 덮는다
    }

    #[test]
    fn chrome_region_is_exactly_slot_sized() {
        // Enhanced session (offset 2,2), no reveal band. The region must expose
        // exactly the slot rect starting at the chrome offset — anything else
        // re-exposes the border or crops the VM.
        let r = chrome_region_rect(2, 2, 0, 1918, 1077).unwrap();
        // offset_x>0(테두리 있음)이므로 아래를 1px 덜 보여준다 — 흰 줄 방지.
        assert_eq!(r, (2, 2 + BOTTOM_BIAS, 2 + 1918 + HORIZONTAL_BUFFER * 2, 2 + 1077 + BOTTOM_BIAS - 1));
        assert_eq!(r.2 - r.0, 1918 + HORIZONTAL_BUFFER * 2);
        assert_eq!(r.3 - r.1, 1077 - 1);
    }

    #[test]
    fn chrome_region_reveal_band_pushes_top_down() {
        // Immersive top-edge reveal: a band crops the VM's top so the header
        // shows through. The visible top moves down by exactly the band.
        let revealed = chrome_region_rect(0, 0, 48, 1000, 800).unwrap();
        assert_eq!(revealed.1, 48 + BOTTOM_BIAS);       // 밴드 + 바이어스만큼 위가 내려감
        assert_eq!(revealed.3, 800 + BOTTOM_BIAS);      // 아래도 바이어스만큼 함께 이동
        assert_eq!(revealed.3 - revealed.1, 800 - 48);  // VM 영역은 밴드만큼만 줄어든다
    }

    #[test]
    fn chrome_region_band_composes_with_chrome_offset() {
        // Both a vmconnect chrome offset AND a reveal band: they add on top.
        let r = chrome_region_rect(2, 53, 48, 1000, 800).unwrap();
        assert_eq!(r.1, 53 + 48 + BOTTOM_BIAS); // ribbon offset + reveal band + bias
        assert_eq!(r.0, 2);       // left chrome unchanged by the band
    }

    // ---- Code-review fixes: generation counter (V5) + claim set (V6) ----
    // Both are plain data-structure invariants with no Win32 dependency, so they
    // get direct unit tests instead of relying only on manual verification.

    #[test]
    fn generation_bump_is_monotonic_and_per_slot() {
        use super::{bump_generation, current_generation};
        let slot = format!("test-slot-{}", std::process::id()); // avoid cross-test collisions
        assert_eq!(current_generation(&slot), 0); // never bumped -> 0
        let g1 = bump_generation(&slot);
        assert_eq!(g1, 1);
        assert_eq!(current_generation(&slot), 1);
        let g2 = bump_generation(&slot);
        assert_eq!(g2, 2, "second bump must move forward, not reset");
        assert_eq!(current_generation(&slot), 2);
        // A different slot's counter is independent.
        let other = format!("test-slot-other-{}", std::process::id());
        assert_eq!(current_generation(&other), 0);
    }

    #[test]
    fn claim_set_excludes_only_while_held() {
        use super::{lock_claimed, excluded_hwnds};
        let fake_hwnd = 0x7fff_0000_isize; // arbitrary, never a real hwnd in this test
        assert!(!excluded_hwnds().contains(&fake_hwnd));
        lock_claimed().insert(fake_hwnd);
        assert!(excluded_hwnds().contains(&fake_hwnd), "claimed hwnd must be excluded");
        lock_claimed().remove(&fake_hwnd);
        assert!(!excluded_hwnds().contains(&fake_hwnd), "release must un-exclude it");
    }
}

#[cfg(test)]
mod cutout_tests {
    use super::{cutout_in_window, framed_rect, BOTTOM_BIAS, HORIZONTAL_BUFFER};

    /// 구멍 좌표가 어긋나면 VM 화면에 엉뚱한 사각 구멍이 뚫린 것처럼 보이는데,
    /// 눈으로는 몇 px 차이를 잡기 어렵다. framed_rect와 역산이 맞는지 고정한다.
    #[test]
    fn cutout_lands_where_the_pill_is() {
        // RDP: 크롬 오프셋 없음
        let (l, t, r, b) = cutout_in_window(0, 0, (10, 4, 200, 36));
        assert_eq!((l, t, r, b),
            (10 + HORIZONTAL_BUFFER, 4 + BOTTOM_BIAS, 210 + HORIZONTAL_BUFFER, 40 + BOTTOM_BIAS));
    }

    #[test]
    fn cutout_compensates_vmconnect_chrome() {
        // vmconnect: 좌 인셋 2, 상단 리본 30
        let (l, t, r, b) = cutout_in_window(2, 30, (10, 4, 200, 36));
        assert_eq!((l, t, r, b),
            (12 + HORIZONTAL_BUFFER, 34 + BOTTOM_BIAS, 212 + HORIZONTAL_BUFFER, 70 + BOTTOM_BIAS));
    }

    /// 콘텐츠 원점은 슬롯이 화면 어디에 있든 창 좌표로 항상 같은 자리다 —
    /// 이게 깨지면 슬롯을 옮길 때마다 구멍이 따로 논다.
    #[test]
    fn content_origin_is_slot_independent() {
        for (sx, sy) in [(0, 0), (223, 79), (1600, 400)] {
            let (wx, wy, _, _) = framed_rect(sx, sy, 800, 600, 2, 30);
            assert_eq!(sx - wx, HORIZONTAL_BUFFER + 2);
            assert_eq!(sy - wy, 30 + BOTTOM_BIAS);
        }
    }
}
