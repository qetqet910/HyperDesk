//! 키 입력 소실 지점 추적용 **진단 전용** 모듈. 기능 코드가 아니다.
//!
//! 목적 하나: *"physical Win 키가 Start를 여는 순간, 입력이 정확히 어느 관찰
//! 지점에서 사라지는가?"* 를 실측으로 좁힌다. 그래서 서로 **독립적인** 관찰
//! 지점 네 개를 **같은 단조 시계**(`Instant`, Windows에서 QPC 기반) 위에 올린다.
//!
//! | 관찰 지점 | 무엇을 증명하나 |
//! |---|---|
//! | `RAW`   | Raw Input(WM_INPUT). 장치 레벨에서 그 키가 시스템에 들어왔는가 |
//! | `LL`    | 우리 `WH_KEYBOARD_LL` 콜백. 훅 체인까지 배달됐는가 |
//! | `FG`    | `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`. Start가 언제 앞에 섰나 |
//! | `ASYNC` | `GetAsyncKeyState` 폴링. 물리 키 상태 변화가 관측되는가 |
//!
//! RAW와 LL은 **서로 다른 전달 경로**다. 둘의 유무 조합이 곧 판정이다:
//! `RAW O / LL X`면 배달 단계에서 사라진 것이고, `RAW X / LL X`면 일반 키보드
//! 이벤트 스트림 바깥이다. 이 모듈은 그 표를 만들기 위해서만 존재한다.
//!
//! **활성화** — 기본은 완전 비활성(스레드도 안 뜬다):
//! ```powershell
//! $env:HYPERDESK_KEYDIAG = "1"            # 진단 계측 켜기
//! $env:HYPERDESK_KEYDIAG_ONESHOT = "1"    # (선택) 훅을 한 번만 설치, 재설치 안 함
//! npm run tauri dev
//! ```
//! 로그: `%TEMP%\hyperdesk-keydiag.log` (시작할 때마다 새로 씀)
//!
//! Raw Input은 **진단 전용**이다. 기능 경로에서 쓰지 말 것 — 여기서 수집하는
//! 이유는 오직 "LL 훅에 안 온 키가 장치 레벨에는 있었나"를 가르기 위해서다.

use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering::Relaxed};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};

// ─── 공통 시계 ──────────────────────────────────────────────────────────────
// 모든 관찰 지점이 이 한 시계를 쓴다. 서로 다른 스레드에서 찍히므로, 시계가
// 다르면 "RAW가 LL보다 먼저였나"를 물을 수 없게 된다.
static T0: OnceLock<Instant> = OnceLock::new();
fn t0() -> Instant {
    *T0.get_or_init(Instant::now)
}
/// 시작 이후 경과 초(마이크로초 해상도).
fn ts() -> f64 {
    t0().elapsed().as_secs_f64()
}

// ─── 활성화 스위치 ──────────────────────────────────────────────────────────
static ENABLED: OnceLock<bool> = OnceLock::new();
pub fn enabled() -> bool {
    *ENABLED.get_or_init(|| {
        // **환경변수에 의존하지 않는다.** `npm run tauri dev`는 Vite → cargo → 앱으로
        // 이어지는 다단계 실행이라 셸에서 설정한 변수가 프로세스까지 전달되지 않는
        // 경우가 있다(실측: `$env:HYPERDESK_KEYDIAG=1`로 3회 실행했으나 진단 로그가
        // 생성되지 않음). 그래서 **debug 빌드면 기본 활성**이고, 릴리즈에서는 변수가
        // 있을 때만 켠다. `HYPERDESK_KEYDIAG=0`으로 명시적으로 끌 수 있다.
        match std::env::var("HYPERDESK_KEYDIAG").ok().as_deref() {
            Some("0") | Some("false") => false,
            Some(_) => true,
            None => cfg!(debug_assertions),
        }
    })
}

/// 훅을 한 번만 설치하고 프로세스 수명 동안 재설치하지 않는 모드.
/// 기존 조사에서 "재설치 자체"가 완전히 배제되지 않았으므로, 재설치를 끈 조건도
/// 만들 수 있어야 한다(`install_keyboard_hook`이 이 값을 본다).
static ONESHOT: OnceLock<bool> = OnceLock::new();
pub fn hook_oneshot() -> bool {
    *ONESHOT.get_or_init(|| {
        // 환경변수 대신 **파일 플래그**로도 켤 수 있게 한다 — 실행 경로를 거치지 않고
        // 껐다 켤 수 있어야 같은 빌드로 두 조건을 비교할 수 있다.
        //   %TEMP%\hyperdesk-keydiag-oneshot  (파일이 있으면 재설치 안 함)
        std::env::var_os("HYPERDESK_KEYDIAG_ONESHOT").is_some()
            || std::env::temp_dir().join("hyperdesk-keydiag-oneshot").exists()
    })
}

// ─── 로그 ───────────────────────────────────────────────────────────────────
fn log_path() -> std::path::PathBuf {
    std::env::temp_dir().join("hyperdesk-keydiag.log")
}
static LOG: OnceLock<Mutex<std::fs::File>> = OnceLock::new();
fn log_file() -> &'static Mutex<std::fs::File> {
    LOG.get_or_init(|| {
        let f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(log_path())
            .expect("keydiag log");
        Mutex::new(f)
    })
}
/// **진단 스레드에서만** 부른다. 훅 콜백에서 부르면 파일 I/O가 콜백 안에 들어가
/// `LowLevelHooksTimeout`을 건드린다(그래서 LL 이벤트는 링을 거쳐 여기로 온다).
fn emit(kind: &str, at: f64, body: &str) {
    if let Ok(mut f) = log_file().lock() {
        let _ = writeln!(f, "[{at:12.6}] {kind:<5} {body}");
        let _ = f.flush();
    }
}

// ─── A. LL 훅 이벤트 수집 ───────────────────────────────────────────────────
/// 훅 콜백이 남기는 원시 기록. **필드를 가공하지 않는다** — 해석은 나중에 하고,
/// 여기서는 `KBDLLHOOKSTRUCT`가 준 값을 그대로 보존한다.
#[derive(Clone, Copy)]
struct LlEvent {
    at: f64,
    code: i32,
    wparam: usize,
    vk: u32,
    scan: u32,
    flags: u32,
    extra: usize,
    tid: u32,
    hook_seq: u32,
}
static LL_RING: OnceLock<Mutex<Vec<LlEvent>>> = OnceLock::new();
fn ll_ring() -> &'static Mutex<Vec<LlEvent>> {
    LL_RING.get_or_init(|| Mutex::new(Vec::with_capacity(4096)))
}
static LL_DROPPED: AtomicU32 = AtomicU32::new(0);

/// 훅 콜백 맨 앞에서 부른다. **절대 블로킹하지 않는다** — `try_lock`이 실패하면
/// 드롭 카운터만 올리고 즉시 돌아온다. 콜백 안에서 락을 기다리면 타임아웃으로
/// 훅이 조용히 제거될 수 있고, 그러면 측정하려던 현상 자체를 계측이 만들어낸다.
#[allow(clippy::too_many_arguments)]
pub fn trace_ll(code: i32, wparam: usize, vk: u32, scan: u32, flags: u32, extra: usize, hook_seq: u32) {
    if !enabled() {
        return;
    }
    let e = LlEvent {
        at: ts(),
        code,
        wparam,
        vk,
        scan,
        flags,
        extra,
        tid: unsafe { windows::Win32::System::Threading::GetCurrentThreadId() },
        hook_seq,
    };
    match ll_ring().try_lock() {
        Ok(mut v) => {
            if v.len() < v.capacity() {
                v.push(e);
            } else {
                LL_DROPPED.fetch_add(1, Relaxed);
            }
        }
        Err(_) => {
            LL_DROPPED.fetch_add(1, Relaxed);
        }
    }
}

fn drain_ll() {
    let taken: Vec<LlEvent> = match ll_ring().try_lock() {
        Ok(mut v) => v.drain(..).collect(),
        Err(_) => return,
    };
    for e in taken {
        const LLKHF_INJECTED: u32 = 0x10;
        const LLKHF_UP: u32 = 0x80;
        emit(
            "LL",
            e.at,
            &format!(
                "vk=0x{:02X} scan=0x{:02X} flags=0x{:02X} {} inj={} extra=0x{:X} code={} wparam=0x{:X} tid={} hookseq={}",
                e.vk,
                e.scan,
                e.flags,
                if e.flags & LLKHF_UP != 0 { "UP  " } else { "DOWN" },
                u8::from(e.flags & LLKHF_INJECTED != 0),
                e.extra,
                e.code,
                e.wparam,
                e.tid,
                e.hook_seq
            ),
        );
    }
}

// ─── 훅 스레드 생존 신호 ────────────────────────────────────────────────────
// "훅이 제거됐다"와 "훅 스레드가 멈췄다"와 "키가 애초에 안 왔다"는 전부 다른
// 원인인데, 훅 로그만으로는 셋이 구분되지 않는다. 스레드가 자기 펌프에서 직접
// 올리는 카운터를 따로 둔다.
static HOOK_TID: AtomicU32 = AtomicU32::new(0);
static HOOK_INSTALL_SEQ: AtomicU32 = AtomicU32::new(0);
static HOOK_PUMP_TICKS: AtomicU64 = AtomicU64::new(0);
static HOOK_LAST_TICK_AT: AtomicU64 = AtomicU64::new(0); // 마이크로초
static HOOK_HANDLE: AtomicU64 = AtomicU64::new(0);

pub fn note_hook_installed(hook_ptr: isize, tid: u32) {
    HOOK_TID.store(tid, Relaxed);
    HOOK_HANDLE.store(hook_ptr as u64, Relaxed);
    let seq = HOOK_INSTALL_SEQ.fetch_add(1, Relaxed) + 1;
    if enabled() {
        emit(
            "HOOK",
            ts(),
            &format!("installed seq={seq} handle=0x{hook_ptr:X} tid={tid} oneshot={}", hook_oneshot()),
        );
    }
}
pub fn hook_install_seq() -> u32 {
    HOOK_INSTALL_SEQ.load(Relaxed)
}
/// 훅 스레드의 메시지 펌프가 살아 있음을 알린다(타이머 틱마다).
pub fn note_hook_pump_tick() {
    HOOK_PUMP_TICKS.fetch_add(1, Relaxed);
    HOOK_LAST_TICK_AT.store(t0().elapsed().as_micros() as u64, Relaxed);
}

// ─── 세션 / 데스크톱 / 윈도우 스테이션 ──────────────────────────────────────
fn user_object_name(h: HANDLE) -> String {
    use windows::Win32::System::StationsAndDesktops::{GetUserObjectInformationW, UOI_NAME};
    unsafe {
        let mut buf = [0u16; 128];
        let mut needed = 0u32;
        if GetUserObjectInformationW(
            h,
            UOI_NAME,
            Some(buf.as_mut_ptr() as *mut _),
            (buf.len() * 2) as u32,
            Some(&mut needed),
        )
        .is_ok()
        {
            let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            String::from_utf16_lossy(&buf[..end])
        } else {
            "<err>".into()
        }
    }
}

fn thread_desktop_name(tid: u32) -> String {
    use windows::Win32::System::StationsAndDesktops::GetThreadDesktop;
    unsafe {
        match GetThreadDesktop(tid) {
            Ok(d) if !d.is_invalid() => user_object_name(HANDLE(d.0)),
            _ => "<err>".into(),
        }
    }
}

fn input_desktop_name() -> String {
    use windows::Win32::System::StationsAndDesktops::{OpenInputDesktop, CloseDesktop, DESKTOP_READOBJECTS, DESKTOP_CONTROL_FLAGS};
    unsafe {
        match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_READOBJECTS) {
            Ok(d) => {
                let n = user_object_name(HANDLE(d.0));
                let _ = CloseDesktop(d);
                n
            }
            // 실패 자체가 정보다 — 입력 데스크톱이 우리가 접근 못 하는 곳이면
            // (보안 데스크톱 등) 여기서 걸린다.
            Err(e) => format!("<err {:?}>", e.code()),
        }
    }
}

fn session_id(pid: u32) -> String {
    use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    unsafe {
        let mut s = 0u32;
        if ProcessIdToSessionId(pid, &mut s).is_ok() {
            s.to_string()
        } else {
            "<err>".into()
        }
    }
}

fn window_station_name() -> String {
    use windows::Win32::System::StationsAndDesktops::GetProcessWindowStation;
    unsafe {
        match GetProcessWindowStation() {
            Ok(w) if !w.is_invalid() => user_object_name(HANDLE(w.0)),
            _ => "<err>".into(),
        }
    }
}

fn window_desc(hwnd: HWND) -> String {
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetWindowTextW, GetWindowThreadProcessId};
    unsafe {
        let mut cls = [0u16; 128];
        let cl = GetClassNameW(hwnd, &mut cls);
        let class = if cl > 0 { String::from_utf16_lossy(&cls[..cl as usize]) } else { String::new() };
        let mut txt = [0u16; 128];
        let tl = GetWindowTextW(hwnd, &mut txt);
        let title = if tl > 0 { String::from_utf16_lossy(&txt[..tl as usize]) } else { String::new() };
        let mut pid = 0u32;
        let tid = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        format!(
            "hwnd=0x{:X} pid={} tid={} sess={} desktop='{}' class='{}' title='{}'",
            hwnd.0 as isize,
            pid,
            tid,
            session_id(pid),
            thread_desktop_name(tid),
            class,
            title
        )
    }
}

// ─── C. 포그라운드 전환 (이벤트 기반) ───────────────────────────────────────
// 200ms 폴링은 전환 시각을 최대 200ms까지 놓치고, 짧게 스쳐간 전환은 통째로
// 못 본다. Start가 뜬 "정확한 시각"이 키 이벤트와의 선후를 가르므로 이벤트
// 기반으로 받는다.
unsafe extern "system" fn win_event_proc(
    _hook: windows::Win32::UI::Accessibility::HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    _idobj: i32,
    _idchild: i32,
    _tid: u32,
    _time: u32,
) {
    if hwnd.is_invalid() {
        return;
    }
    emit("FG", ts(), &window_desc(hwnd));
}

// ─── B. Raw Input ───────────────────────────────────────────────────────────
const WM_INPUT: u32 = 0x00FF;

unsafe extern "system" fn diag_wndproc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    use windows::Win32::UI::Input::{GetRawInputData, HRAWINPUT, RAWINPUT, RAWINPUTHEADER, RID_INPUT};
    use windows::Win32::UI::WindowsAndMessaging::DefWindowProcW;

    if msg == WM_INPUT {
        let at = ts();
        let mut size = 0u32;
        let hdr = std::mem::size_of::<RAWINPUTHEADER>() as u32;
        GetRawInputData(HRAWINPUT(l.0 as *mut _), RID_INPUT, None, &mut size, hdr);
        if size > 0 && (size as usize) <= std::mem::size_of::<RAWINPUT>() + 64 {
            let mut buf = vec![0u8; size as usize];
            let got = GetRawInputData(
                HRAWINPUT(l.0 as *mut _),
                RID_INPUT,
                Some(buf.as_mut_ptr() as *mut _),
                &mut size,
                hdr,
            );
            if got == size {
                let ri = &*(buf.as_ptr() as *const RAWINPUT);
                // 1 == RIM_TYPEKEYBOARD
                if ri.header.dwType == 1 {
                    let k = ri.data.keyboard;
                    emit(
                        "RAW",
                        at,
                        &format!(
                            "vk=0x{:02X} make=0x{:02X} rflags=0x{:04X} msg=0x{:04X} extra=0x{:X} dev=0x{:X}",
                            k.VKey, k.MakeCode, k.Flags, k.Message, k.ExtraInformation,
                            ri.header.hDevice.0 as isize
                        ),
                    );
                }
            }
        }
    }
    DefWindowProcW(hwnd, msg, w, l)
}

/// 시작 시 키보드 장치 목록을 남긴다. RAW 이벤트의 `dev=` 핸들만으로는 어느
/// 물리 키보드인지 알 수 없는데, "LWIN만 사라진다"(Case 5)를 장치/펌웨어 문제로
/// 승격할지 판단하려면 그 대조표가 필요하다. 주입된 입력은 `dev=0x0`으로 온다.
fn dump_raw_devices() {
    use windows::Win32::UI::Input::{
        GetRawInputDeviceInfoW, GetRawInputDeviceList, RAWINPUTDEVICELIST, RIDI_DEVICENAME,
        RID_DEVICE_INFO_TYPE,
    };
    unsafe {
        let mut count = 0u32;
        let sz = std::mem::size_of::<RAWINPUTDEVICELIST>() as u32;
        if GetRawInputDeviceList(None, &mut count, sz) == u32::MAX || count == 0 {
            emit("ENV", ts(), "raw device list: <none>");
            return;
        }
        let mut list = vec![RAWINPUTDEVICELIST::default(); count as usize];
        let got = GetRawInputDeviceList(Some(list.as_mut_ptr()), &mut count, sz);
        if got == u32::MAX {
            emit("ENV", ts(), "raw device list: <err>");
            return;
        }
        for d in list.iter().take(got as usize) {
            // 1 == RIM_TYPEKEYBOARD
            if d.dwType != RID_DEVICE_INFO_TYPE(1) {
                continue;
            }
            let mut n = 0u32;
            GetRawInputDeviceInfoW(d.hDevice, RIDI_DEVICENAME, None, &mut n);
            let mut buf = vec![0u16; (n as usize).max(1)];
            let r = GetRawInputDeviceInfoW(
                d.hDevice,
                RIDI_DEVICENAME,
                Some(buf.as_mut_ptr() as *mut _),
                &mut n,
            );
            let name = if r != u32::MAX {
                let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                String::from_utf16_lossy(&buf[..end])
            } else {
                "<err>".into()
            };
            emit("ENV", ts(), &format!("raw keyboard dev=0x{:X} name='{}'", d.hDevice.0 as isize, name));
        }
    }
}

// ─── E. GetAsyncKeyState 보조 계측 ──────────────────────────────────────────
// 입력 소스의 대체물이 아니다. RAW도 LL도 못 봤는데 이 상태가 바뀌면, 키 자체는
// 시스템이 인지했다는 **독립적인** 증거가 된다.
fn poll_async_keys(prev: &mut (bool, bool)) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LWIN, VK_RWIN};
    unsafe {
        let down = |vk: i32| (GetAsyncKeyState(vk) as u16 & 0x8000) != 0;
        let now = (down(VK_LWIN.0 as i32), down(VK_RWIN.0 as i32));
        if now != *prev {
            emit(
                "ASYNC",
                ts(),
                &format!(
                    "LWIN={} RWIN={}",
                    if now.0 { "DOWN" } else { "up" },
                    if now.1 { "DOWN" } else { "up" }
                ),
            );
            *prev = now;
        }
    }
}

// ─── 진단 스레드 ────────────────────────────────────────────────────────────
static STARTED: AtomicBool = AtomicBool::new(false);

/// `lib.rs` setup에서 부른다. `HYPERDESK_KEYDIAG`가 없으면 아무것도 하지 않는다.
pub fn start(main_hwnd: isize) {
    if !enabled() || STARTED.swap(true, Relaxed) {
        return;
    }
    let _ = t0();
    std::thread::spawn(move || unsafe {
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::System::Threading::{GetCurrentProcessId, GetCurrentThreadId};
        use windows::Win32::UI::Accessibility::SetWinEventHook;
        use windows::Win32::UI::Input::{RegisterRawInputDevices, RAWINPUTDEVICE, RIDEV_INPUTSINK};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DispatchMessageW, GetMessageW, RegisterClassW, SetTimer,
            TranslateMessage, CW_USEDEFAULT, EVENT_SYSTEM_FOREGROUND, HMENU, MSG, WINEVENT_OUTOFCONTEXT,
            WINDOW_EX_STYLE, WNDCLASSW, WS_OVERLAPPED,
        };

        let pid = GetCurrentProcessId();
        let my_tid = GetCurrentThreadId();

        emit("ENV", ts(), &format!("keydiag start — log={}", log_path().display()));
        emit(
            "ENV",
            ts(),
            &format!(
                "process pid={pid} session={} winsta='{}' diag_tid={my_tid} diag_desktop='{}'",
                session_id(pid),
                window_station_name(),
                thread_desktop_name(my_tid)
            ),
        );
        emit("ENV", ts(), &format!("input_desktop='{}'", input_desktop_name()));
        emit("ENV", ts(), &format!("main_hwnd=0x{main_hwnd:X} oneshot={}", hook_oneshot()));

        // Raw Input 싱크용 숨은 창. INPUTSINK는 유효한 hwndTarget을 요구하고,
        // 포그라운드가 아닐 때도 입력을 받게 해준다 — 우리는 포그라운드를 남에게
        // 뺏긴 순간의 입력을 봐야 하므로 이 플래그가 핵심이다.
        let class_name: Vec<u16> = "HyperDeskKeyDiag\0".encode_utf16().collect();
        let hinst = GetModuleHandleW(None).unwrap_or_default();
        let wc = WNDCLASSW {
            lpfnWndProc: Some(diag_wndproc),
            hInstance: hinst.into(),
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };
        RegisterClassW(&wc);
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            PCWSTR(class_name.as_ptr()),
            PCWSTR(class_name.as_ptr()),
            WS_OVERLAPPED,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            0,
            0,
            None,
            HMENU::default(),
            hinst,
            None,
        );
        match hwnd {
            Ok(h) => {
                let dev = RAWINPUTDEVICE {
                    usUsagePage: 0x01, // Generic Desktop
                    usUsage: 0x06,     // Keyboard
                    dwFlags: RIDEV_INPUTSINK,
                    hwndTarget: h,
                };
                let ok = RegisterRawInputDevices(&[dev], std::mem::size_of::<RAWINPUTDEVICE>() as u32);
                emit(
                    "ENV",
                    ts(),
                    &format!("raw input sink hwnd=0x{:X} registered={}", h.0 as isize, ok.is_ok()),
                );
            }
            Err(e) => emit("ENV", ts(), &format!("raw input window FAILED: {e:?}")),
        }

        // 포그라운드 전환 이벤트. OUTOFCONTEXT라 이 스레드의 메시지 펌프로 배달된다.
        let weh = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(win_event_proc),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
        emit("ENV", ts(), &format!("winevent hook installed={}", !weh.is_invalid()));
        dump_raw_devices();

        // **타이머는 하나만 건다.** `SetTimer(NULL, id, ..)`는 넘긴 id를 **무시하고
        // 새 ID를 반환**하므로, wParam으로 타이머를 구분하려던 최초 구현은 세 타이머가
        // 전부 같은 분기로 떨어졌다(실측: LL 배출과 async 폴링이 한 번도 실행되지 않아
        // 관측 지점 둘이 통째로 침묵했고, 하트비트만 15ms마다 3459줄 쌓였다).
        // 틱을 세서 주기를 나눈다 — ID 매칭이 필요 없다.
        SetTimer(HWND(std::ptr::null_mut()), 0, 15, None);

        let mut prev_async = (false, false);
        let mut tick: u64 = 0;
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            if msg.message == windows::Win32::UI::WindowsAndMessaging::WM_TIMER {
                tick = tick.wrapping_add(1);
                poll_async_keys(&mut prev_async); // 매 틱(15ms)
                if tick % 4 == 0 {
                    drain_ll(); // ~60ms
                }
                if tick % 67 == 0 {
                    // ~1s
                        let last = HOOK_LAST_TICK_AT.load(Relaxed);
                        let now = t0().elapsed().as_micros() as u64;
                        emit(
                            "HB",
                            ts(),
                            &format!(
                                "hook_tid={} hook_handle=0x{:X} installs={} pump_ticks={} last_pump_tick={:.3}s_ago ll_dropped={} oneshot={}",
                                HOOK_TID.load(Relaxed),
                                HOOK_HANDLE.load(Relaxed),
                                HOOK_INSTALL_SEQ.load(Relaxed),
                                HOOK_PUMP_TICKS.load(Relaxed),
                                (now.saturating_sub(last)) as f64 / 1e6,
                                LL_DROPPED.load(Relaxed),
                                hook_oneshot()
                            ),
                        );
                }
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}

#[cfg(test)]
mod tests {
    /// 환경 프로브(세션 / 윈도우 스테이션 / 데스크톱 이름)는 실패해도 `<err>`만
    /// 남기고 조용히 넘어간다 — FFI 인자를 틀리면 진단 로그가 통째로 무의미해지는데
    /// 화면상으로는 멀쩡해 보인다. 실제 값이 나오는지 고정한다.
    #[test]
    fn environment_probes_return_real_values() {
        use super::{session_id, thread_desktop_name, window_station_name};
        use windows::Win32::System::Threading::{GetCurrentProcessId, GetCurrentThreadId};

        let sid = session_id(unsafe { GetCurrentProcessId() });
        assert!(sid.parse::<u32>().is_ok(), "세션 ID가 숫자여야 한다: {sid}");

        let winsta = window_station_name();
        assert!(!winsta.is_empty() && !winsta.starts_with('<'), "윈도우 스테이션 이름: {winsta}");

        let desk = thread_desktop_name(unsafe { GetCurrentThreadId() });
        assert!(!desk.is_empty() && !desk.starts_with('<'), "스레드 데스크톱 이름: {desk}");
    }

    /// 진단이 꺼져 있으면 훅 콜백 경로는 **아무 일도 하지 않아야** 한다.
    /// 여기서 락을 잡거나 할당을 하면 계측이 측정 대상을 바꿔버린다.
    #[test]
    fn trace_is_inert_when_disabled() {
        use super::{enabled, trace_ll, LL_DROPPED};
        use std::sync::atomic::Ordering::Relaxed;
        if enabled() {
            return; // 환경변수가 켜진 채로 테스트를 돌리는 경우는 건너뛴다
        }
        let before = LL_DROPPED.load(Relaxed);
        for _ in 0..1000 {
            trace_ll(0, 0x100, 0x5B, 0x5B, 0, 0, 1);
        }
        assert_eq!(LL_DROPPED.load(Relaxed), before, "비활성 상태에서는 링을 건드리지 않는다");
        assert!(super::LL_RING.get().is_none(), "비활성 상태에서는 링을 만들지도 않는다");
    }
}
