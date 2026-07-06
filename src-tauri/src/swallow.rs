use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM, BOOL};
use windows::Win32::UI::WindowsAndMessaging::{
    SetParent, SetWindowLongPtrW, GetWindowLongPtrW, SetWindowPos, GetClassNameW,
    GWL_STYLE, GWL_EXSTYLE, WS_CAPTION, WS_THICKFRAME, WS_BORDER, WS_CHILD, WS_POPUP,
    WS_CLIPSIBLINGS, WS_EX_TOPMOST, WS_EX_APPWINDOW, WS_EX_MDICHILD,
    SWP_SHOWWINDOW, SWP_FRAMECHANGED, SWP_ASYNCWINDOWPOS, SWP_NOCOPYBITS,
    SWP_NOZORDER, SWP_NOACTIVATE, SWP_NOOWNERZORDER,
    EnumWindows, GetWindowThreadProcessId, IsWindowVisible,
    EnumChildWindows, IsWindow, HWND_TOP, GetWindowRect,
    SetForegroundWindow, BringWindowToTop, SetMenu, PostMessageW, WM_CLOSE,
};
use windows::Win32::Graphics::Gdi::{ScreenToClient, ClientToScreen, CreateRectRgn, SetWindowRgn, HRGN};
use windows::Win32::Foundation::{RECT, POINT};

use tauri::{AppHandle, Emitter};

// WIP dev-only file log (elevation detaches stderr from the console). Append to
// %TEMP%\hyperdesk-swallow.log. Remove with all dlog! calls once swallow is stable.
#[cfg(debug_assertions)]
pub fn dlog(line: &str) {
    use std::io::Write;
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
    /// (BBarWindowClass) is created lazily and can REappear on focus/unmaximize after
    /// the 40s stabilization loop ends, so focus_window re-hides it using this pid.
    pub vmconnect_pid: Option<u32>,
}

const DEFAULT_OFFSET: i32 = 0; // Styles successfully removed
const HYPERV_OFFSET: i32 = 30;  // Hyper-V Ribbon
const HORIZON_OFFSET: i32 = 0; // Horizon usually reacts well to style removal
const HORIZONTAL_BUFFER: i32 = 0; // Remove buffer for 1:1 fit at 100% DPI

/// Extra top rows (physical px) currently cropped away for the immersive
/// header reveal — 0 when not immersive/not hovering the top edge. This is
/// the SINGLE source of truth for that band: every SetWindowRgn call in this
/// file (initial swallow, the vmconnect stabilization loop's re-measurement,
/// and the immersive poller itself) goes through `apply_chrome_region` below,
/// which always composes the window's own chrome crop (offset/offset_x) with
/// this value. Without a single source, the vmconnect stabilization loop
/// (which re-applies its OWN region on every re-measured tick, for up to 40s
/// after swallow) would periodically stomp the reveal crop back to "hidden"
/// — RDP never showed this bug because its offset is always 0 and nothing
/// else touches its region after the initial swallow.
static REVEAL_BAND: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

/// Pure geometry for the chrome clip region: given the left/top chrome offsets,
/// the current immersive reveal band, and the slot size, returns the visible
/// rect (left, top, right, bottom) in the window's own coordinates — or None
/// when there is nothing to clip (region should be cleared). Split out from the
/// Win32 call so the geometry that caused the white-border bugs is unit-testable.
fn chrome_region_rect(offset_x: i32, offset: i32, band: i32, width: i32, height: i32) -> Option<(i32, i32, i32, i32)> {
    let top = offset + band;
    if top == 0 && offset_x == 0 {
        None
    } else {
        Some((offset_x, top, offset_x + width + (HORIZONTAL_BUFFER * 2), offset + height))
    }
}

/// Crops rows 0..offset and cols 0..offset_x (the window's own non-removable
/// chrome, e.g. VMConnect's ribbon) PLUS the current immersive reveal band,
/// or clears the region entirely when there is nothing to hide.
fn apply_chrome_region(hwnd: HWND, offset_x: i32, offset: i32, width: i32, height: i32) {
    let band = REVEAL_BAND.load(std::sync::atomic::Ordering::Relaxed);
    unsafe {
        match chrome_region_rect(offset_x, offset, band, width, height) {
            None => { let _ = SetWindowRgn(hwnd, HRGN::default(), BOOL::from(true)); }
            Some((l, t, r, b)) => {
                let rgn = CreateRectRgn(l, t, r, b);
                if !rgn.is_invalid() {
                    let _ = SetWindowRgn(hwnd, rgn, BOOL::from(true));
                }
            }
        }
    }
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
fn framed_rect(x: i32, y: i32, w: i32, h: i32, offset_x: i32, offset: i32) -> (i32, i32, i32, i32) {
    (
        x - HORIZONTAL_BUFFER - offset_x,
        y - offset,
        w + (HORIZONTAL_BUFFER * 2) + offset_x * 2,
        h + offset + offset_x,
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
}

struct ChildParam { 
    found: HWND 
}

pub fn find_main_window(pid: u32) -> Option<HWND> {
    let mut param = EnumParam {
        target_pid: pid,
        found_hwnd: HWND(std::ptr::null_mut()),
    };
    unsafe {
        let _ = EnumWindows(Some(enum_windows_callback), LPARAM(&mut param as *mut EnumParam as isize));
    }
    
    if !param.found_hwnd.is_invalid() {
        return Some(param.found_hwnd);
    }

    let mut fallback_param = EnumParam {
        target_pid: 0, 
        found_hwnd: HWND(std::ptr::null_mut()),
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
    let mut pid = 0;
    unsafe {
        let thread_id = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if thread_id == 0 { return BOOL::from(true); }
        
        if (param.target_pid == 0 || pid == param.target_pid) && IsWindowVisible(hwnd).as_bool() {
             let mut class_name = [0u16; 256];
             let len = GetClassNameW(hwnd, &mut class_name);
             if len > 0 {
                 let class_str = String::from_utf16_lossy(&class_name[..len as usize]);
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
             }
             if param.target_pid != 0 && param.found_hwnd.is_invalid() {
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
    eprintln!("[swallow-tree] ==== other top-level windows owned by pid={} ====", pid);
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
        eprintln!(
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

pub fn swallow(slot_id: &str, target_pid: u32, parent_hwnd: HWND, app_handle: AppHandle, bounds: SlotBounds) -> Result<(), String> {
    let s_id = slot_id.to_string();
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
            // Preferred: a window with a KNOWN session class (pid-scoped first,
            // then the class-list fallback inside find_main_window).
            let mut candidate: Option<HWND> = find_main_window(target_pid)
                .filter(|h| !chain.contains(&(h.0 as isize)));

            // After the first stage, only KNOWN session classes may come from the
            // pid-scoped search — its "any visible window of the pid" fallback
            // would otherwise hand us vmconnect's floating toolbar (BBar) or an
            // IME window as a bogus next stage.
            if let Some(h) = candidate {
                if !chain.is_empty() {
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
                candidate = find_horizon_session_window(&chain);
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
                    }
                }
                chain.push(h.0 as isize);
                current = Some(h_wrap);
                let _ = perform_swallow(&s_id, h_wrap, actual_parent, app.clone(), bounds);

                if is_session {
                    session_found = true;
                    break;
                }
                // Launcher/intermediate window swallowed — tell the frontend so
                // it starts bounds-syncing, then keep hunting for the session.
                let _ = app.emit("swallow-progress", s_id.clone());
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
        });

        let (fx, fy, fw, fh) = framed_rect(x, y, width, height, offset_x, offset);
        let _ = SetWindowPos(
            child_hwnd, HWND(std::ptr::null_mut()),
            fx, fy, fw, fh,
            SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOCOPYBITS
        );

        // Clip the non-removable chrome (e.g. VMConnect ribbon + left inset),
        // composed with any currently-active immersive reveal band.
        apply_chrome_region(child_hwnd, offset_x, offset, width, height);
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

    std::thread::spawn(move || {
        // Adaptive backoff: apps fight hardest right after swallow, so poll fast
        // (100ms) then ease off to 1s once the window stays put. Any correction
        // resets to fast. Covers the same ~40s window as the old fixed 200×200ms
        // loop with a fraction of the wakeups once stable. ponytail: heuristic
        // backoff, swap for SetWinEventHook only if a real app still escapes.
        const FAST_MS: u64 = 100;
        const SLOW_MS: u64 = 1000;
        let start = std::time::Instant::now();
        let deadline = start + std::time::Duration::from_secs(40);
        let mut interval_ms = FAST_MS;
        // WIP: re-dump the tree once ~6s in, after a Basic→Enhanced session-mode
        // switch would have replaced the child tree. Confirms whether the chrome we
        // measured at swallow time still matches the settled session.
        #[cfg(debug_assertions)]
        let mut redumped = false;

        while std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(interval_ms));

            #[cfg(debug_assertions)]
            if !redumped && start.elapsed().as_secs() >= 6 {
                redumped = true;
                let h = HWND(h_child_raw as *mut _);
                if unsafe { IsWindow(h).as_bool() } {
                    dlog!("[swallow-tree] ==== SETTLED re-dump (6s) ====");
                    dump_window_tree(h);
                }
            }

            let (target_rect, is_visible, is_active) = {
                let state = lock_state();
                if let Some(info) = state.get(&s_id) {
                    if info.child_hwnd != h_child_raw { break; } 
                    ((info.x, info.y, info.width, info.height), info.is_visible, true)
                } else {
                    ((0, 0, 0, 0), false, false)
                }
            };
            if !is_active { break; }
            if !is_visible { continue; }

            if let Some(pid) = vmconnect_pid_cap {
                hide_vmconnect_bbar(pid);
            }

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

                if needs_refresh {
                    let (fx, fy, fw, fh) = framed_rect(target_rect.0, target_rect.1, target_rect.2, target_rect.3, offset_x_cap, offset_cap);
                    let _ = SetWindowPos(
                        h_child,
                        HWND(std::ptr::null_mut()),
                        fx, fy, fw, fh,
                        SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE
                    );
                    // Re-apply chrome clip region in case the app reset it — composed
                    // with any active immersive reveal band via apply_chrome_region,
                    // so this can never stomp a reveal the top-edge poller just made.
                    apply_chrome_region(h_child, offset_x_cap, offset_cap, target_rect.2, target_rect.3);
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
pub fn unswallow(slot_id: &str) -> Result<(), String> {
    let mut state = lock_state();
    if let Some(info) = state.remove(slot_id) {
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
    let mut state = lock_state();
    if let Some(info) = state.get_mut(slot_id) {
        info.is_visible = visible;
        let hwnd = HWND(info.child_hwnd as *mut _);
        unsafe {
            if IsWindow(hwnd).as_bool() {
                if visible {
                    // The offsets resolved (and possibly re-measured) at swallow time —
                    // NOT get_offset(class), which knows nothing about the measured
                    // vmconnect chrome and would misplace the frame on re-show.
                    let (fx, fy, fw, fh) = framed_rect(info.x, info.y, info.width, info.height, info.offset_x, info.offset);
                    let _ = SetWindowPos(
                        hwnd, HWND(std::ptr::null_mut()),
                        fx, fy, fw, fh,
                        SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE
                    );
                } else {
                    let _ = SetWindowPos(
                        hwnd, HWND(std::ptr::null_mut()),
                        -10000, -10000, 800, 600,
                        SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE
                    );
                }
            }
        }
    }
    Ok(())
}

pub fn update_position(slot_id: &str, x: i32, y: i32, width: i32, height: i32) {
    let mut state = lock_state();
    if let Some(info) = state.get_mut(slot_id) {
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
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowsHookExW, GetMessageW, MSG, WH_KEYBOARD_LL};
    let _ = APP_HANDLE.set(app);
    MAIN_HWND.store(main_hwnd, std::sync::atomic::Ordering::Relaxed);
    std::thread::spawn(|| unsafe {
        // LL hooks need a message pump on the installing thread.
        if SetWindowsHookExW(WH_KEYBOARD_LL, Some(ll_keyboard_proc), None, 0).is_err() {
            return;
        }
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
    });
}

// ─── Immersive mode: top-edge cursor watcher ─────────────────────────────────
//
// In immersive mode the header floats (position:absolute) UNDER the VM surface
// so the VM owns 100% of the screen at native resolution. Mouse moves over the
// VM go to the VM's process — the webview never sees them — so the top edge is
// detected by an OS cursor poll. The reveal itself is a SetWindowRgn crop of
// the VM's top band: the WebView header underneath shows through and receives
// clicks, and the VM never moves or resizes (no scaling/relayout churn).
// ponytail: 80ms polling; swap for a WH_MOUSE_LL hook only if it shows up in
// profiles.

static IMMERSIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Poll-loop clock base + a "hold reveal until" deadline (ms since base). Set by
/// flash_immersive_header so a slot switch pops the header for ~1s even with the
/// cursor nowhere near the top edge.
static POLL_CLOCK: OnceLock<std::time::Instant> = OnceLock::new();
static HOLD_UNTIL_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn poll_now_ms() -> u64 {
    POLL_CLOCK.get_or_init(std::time::Instant::now).elapsed().as_millis() as u64
}

/// The reveal band at full height (36 CSS px → physical px via the main window DPI).
fn full_band() -> i32 {
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    let main = MAIN_HWND.load(std::sync::atomic::Ordering::Relaxed);
    let dpi = if main != 0 { unsafe { GetDpiForWindow(HWND(main as *mut _)) } } else { 96 };
    (36 * dpi.max(96) as i32) / 96
}

/// Set the reveal crop band to an exact physical-px height and re-clip every
/// visible swallowed window. Driving the band directly (not just on/off) lets the
/// hide path RAMP it down in step with the DOM header's slide-up, so the black
/// header band shrinks together with the header instead of vanishing a frame late.
fn set_reveal_band_px(band: i32) {
    REVEAL_BAND.store(band, std::sync::atomic::Ordering::Relaxed);
    let entries: Vec<(isize, i32, i32, i32, i32)> = lock_state().values()
        .filter(|i| i.is_visible)
        .map(|i| (i.child_hwnd, i.offset_x, i.offset, i.width, i.height))
        .collect();
    for (raw, ox, oy, w, h) in entries {
        let hwnd = HWND(raw as *mut _);
        if !unsafe { IsWindow(hwnd) }.as_bool() { continue; }
        apply_chrome_region(hwnd, ox, oy, w, h);
    }
}

/// Crop (shown) or restore (hidden) the top 36-CSS-px band of every visible
/// swallowed window, composing with each window's own chrome mask via the
/// shared REVEAL_BAND (see its doc comment for why this must be shared).
fn apply_reveal(shown: bool) {
    set_reveal_band_px(if shown { full_band() } else { 0 });
}

/// Force the immersive header to reveal for `ms`, then auto-hide — used on slot
/// switch so the user sees which slot is now active (the header's 1~4 highlight)
/// without having to hunt for the top edge.
pub fn flash_immersive_header(ms: u64) {
    if !IMMERSIVE.load(std::sync::atomic::Ordering::Relaxed) { return; }
    HOLD_UNTIL_MS.store(poll_now_ms() + ms, std::sync::atomic::Ordering::Relaxed);
}

/// Notify the frontend of the reveal state so its (always-present, absolutely-
/// positioned) header can slide in/out. Split from apply_reveal so the poller can
/// order the emit vs. the native crop differently per direction — see set_immersive.
fn emit_edge(shown: bool) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit("immersive-edge", shown);
    }
}

pub fn set_immersive(on: bool) {
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    IMMERSIVE.store(on, std::sync::atomic::Ordering::Relaxed);
    if !on {
        emit_edge(false);
        apply_reveal(false); // never leave a crop behind when exiting immersive
    }
    static POLLER: OnceLock<()> = OnceLock::new();
    POLLER.get_or_init(|| {
        std::thread::spawn(|| {
            let mut shown = false;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(80));
                if !IMMERSIVE.load(std::sync::atomic::Ordering::Relaxed) {
                    if shown {
                        shown = false;
                        emit_edge(false);
                        apply_reveal(false);
                    }
                    continue;
                }
                let mut p = POINT::default();
                if unsafe { GetCursorPos(&mut p) }.is_err() { continue; }
                // Reveal when the cursor hits the very top edge (kept shown within a
                // generous 64px band), OR while a slot-switch flash hold is active.
                let held = poll_now_ms() < HOLD_UNTIL_MS.load(std::sync::atomic::Ordering::Relaxed);
                let want = held || if shown { p.y <= 64 } else { p.y <= 2 };
                if want != shown {
                    shown = want;
                    if want {
                        // SHOW: open the crop first, then the DOM header slides down
                        // into the now-visible band.
                        apply_reveal(true);
                        emit_edge(true);
                    } else {
                        // HIDE: the header lives UNDER the VM surface, so if we closed
                        // the crop at once the VM would instantly cover the slide-up.
                        // Slide the DOM header up FIRST, wait out the ~180ms CSS
                        // transition, then close the crop with a SINGLE SetWindowRgn.
                        // (A per-step band ramp re-clipped the fullscreen VM 7× and
                        // made it stutter — one close keeps it smooth.)
                        emit_edge(false);
                        std::thread::sleep(std::time::Duration::from_millis(185));
                        // Cursor returned to the top, or a flash hold armed → re-reveal.
                        let mut np = POINT::default();
                        let back = unsafe { GetCursorPos(&mut np) }.is_ok() && np.y <= 2;
                        let held2 = poll_now_ms() < HOLD_UNTIL_MS.load(std::sync::atomic::Ordering::Relaxed);
                        if back || held2 {
                            shown = true;
                            apply_reveal(true);
                            emit_edge(true);
                        } else {
                            apply_reveal(false);
                        }
                    }
                }
            }
        });
    });
}

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
        let is_slot_key = alt_down && (0x31..=0x34).contains(&kb.vkCode);

        if !injected && is_slot_key {
            let up = kb.flags.0 & LLKHF_UP.0 != 0;
            if vm_key_target().is_some() {
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
        // vmconnect re-creates its connect-bar on focus; the 40s stabilization loop
        // that normally re-hides it has ended by now, so hide it here too.
        if let Some(pid) = vmconnect_pid {
            hide_vmconnect_bbar(pid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{framed_rect, chrome_region_rect, HORIZONTAL_BUFFER};

    // The invariant that fixes the white-border bug: the swallowed frame is
    // positioned/sized so the CONTENT (client area, inset by the symmetric
    // non-client border on every side) exactly fills the slot. With a border of
    // `b` on all sides and a top ribbon `ribbon`, offset_x = b and offset =
    // b + ribbon. Then: window origin = slot - (offset_x, offset), window size
    // must cover slot + border on the far sides too.
    #[test]
    fn framed_rect_rdp_is_slot_identity() {
        // RDP/Horizon: no chrome → frame == slot exactly (no white border work).
        assert_eq!(framed_rect(100, 50, 1918, 1077, 0, 0), (100, 50, 1918, 1077));
    }

    #[test]
    fn framed_rect_enhanced_session_covers_all_four_borders() {
        // Enhanced vmconnect: symmetric 2px non-client border, no ribbon.
        // offset_x = 2, offset = 2. Content must fill the whole slot.
        let (x, y, w, h) = framed_rect(100, 50, 1918, 1077, 2, 2);
        assert_eq!((x, y), (98, 48)); // shifted up-left by the border
        // width/height grow by the border on BOTH sides (this is the exact fix
        // for the right/bottom 2px white edge).
        assert_eq!(w, 1918 + 4);
        assert_eq!(h, 1077 + 4);
        // Client area = window minus border on all sides == the slot.
        let border = 2;
        assert_eq!(w - 2 * border, 1918);
        assert_eq!(h - 2 * border, 1077);
        // And the client's top-left lands exactly on the slot origin.
        assert_eq!(x + border, 100);
        assert_eq!(y + border, 50);
    }

    #[test]
    fn framed_rect_basic_session_ribbon_only_shifts_top() {
        // Basic vmconnect: 2px border + 51px ribbon. offset_x=2, offset=53.
        // Bottom border is just the 2px (offset_x), NOT offset — the ribbon is
        // top-only. This is why height adds `offset + offset_x`, not `2*offset`.
        let (x, y, w, h) = framed_rect(0, 0, 1000, 800, 2, 53);
        assert_eq!(x, -2);
        assert_eq!(y, -53);
        assert_eq!(w, 1000 + 4);      // left+right border
        assert_eq!(h, 800 + 53 + 2);  // top(border+ribbon) + bottom(border)
    }

    #[test]
    fn chrome_region_none_when_nothing_to_clip() {
        // RDP, no reveal: no offsets, no band → clear the region.
        assert_eq!(chrome_region_rect(0, 0, 0, 1918, 1077), None);
    }

    #[test]
    fn chrome_region_is_exactly_slot_sized() {
        // Enhanced session (offset 2,2), no reveal band. The region must expose
        // exactly the slot rect starting at the chrome offset — anything else
        // re-exposes the border or crops the VM.
        let r = chrome_region_rect(2, 2, 0, 1918, 1077).unwrap();
        assert_eq!(r, (2, 2, 2 + 1918 + HORIZONTAL_BUFFER * 2, 2 + 1077));
        assert_eq!(r.2 - r.0, 1918 + HORIZONTAL_BUFFER * 2);
        assert_eq!(r.3 - r.1, 1077);
    }

    #[test]
    fn chrome_region_reveal_band_pushes_top_down() {
        // Immersive top-edge reveal: a band crops the VM's top so the header
        // shows through. The visible top moves down by exactly the band.
        assert_eq!(chrome_region_rect(0, 0, 0, 1000, 800), None); // no band, nothing to clip
        let revealed = chrome_region_rect(0, 0, 48, 1000, 800).unwrap();
        assert_eq!(revealed.1, 48);                     // top pushed down by the band
        assert_eq!(revealed.3, 800);                    // bottom unchanged
        assert_eq!(revealed.3 - revealed.1, 800 - 48);  // VM area shrinks by the band
    }

    #[test]
    fn chrome_region_band_composes_with_chrome_offset() {
        // Both a vmconnect chrome offset AND a reveal band: they add on top.
        let r = chrome_region_rect(2, 53, 48, 1000, 800).unwrap();
        assert_eq!(r.1, 53 + 48); // ribbon offset + reveal band
        assert_eq!(r.0, 2);       // left chrome unchanged by the band
    }
}
