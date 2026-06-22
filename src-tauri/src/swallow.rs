use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use windows::Win32::Foundation::{HWND, LPARAM, BOOL};
use windows::Win32::UI::WindowsAndMessaging::{
    SetParent, SetWindowLongPtrW, GetWindowLongPtrW, SetWindowPos, GetClassNameW,
    GWL_STYLE, GWL_EXSTYLE, WS_CAPTION, WS_THICKFRAME, WS_BORDER, WS_CHILD, WS_POPUP,
    WS_CLIPSIBLINGS, WS_EX_TOPMOST, WS_EX_APPWINDOW, WS_EX_MDICHILD,
    SWP_SHOWWINDOW, SWP_FRAMECHANGED, SWP_ASYNCWINDOWPOS, SWP_NOCOPYBITS,
    SWP_NOZORDER, SWP_NOACTIVATE, SWP_NOOWNERZORDER,
    EnumWindows, GetWindowThreadProcessId, IsWindowVisible,
    EnumChildWindows, IsWindow, HWND_TOP, GetWindowRect,
    SetForegroundWindow, BringWindowToTop, SetMenu,
};
use windows::Win32::Graphics::Gdi::{ScreenToClient, CreateRectRgn, SetWindowRgn};
use windows::Win32::Foundation::{RECT, POINT};

use tauri::{AppHandle, Emitter};

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
    pub offset: i32,
}

const DEFAULT_OFFSET: i32 = 0; // Styles successfully removed
const HYPERV_OFFSET: i32 = 30;  // Hyper-V Ribbon
const HORIZON_OFFSET: i32 = 0; // Horizon usually reacts well to style removal
const HORIZONTAL_BUFFER: i32 = 0; // Remove buffer for 1:1 fit at 100% DPI

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

fn hide_vmconnect_bbar(pid: u32) {
    if let Some(bar) = find_vmconnect_bbar(pid) {
        unsafe {
            if IsWindowVisible(bar).as_bool() {
                #[cfg(debug_assertions)]
                eprintln!("[swallow-tree] vmconnect BBar (connect bar) found visible, hiding");
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
        eprintln!(
            "[swallow-tree] hwnd={:?} class='{}' rect=({},{} {}x{}) visible={}",
            hwnd.0, class, r.left, r.top, r.right - r.left, r.bottom - r.top,
            IsWindowVisible(hwnd).as_bool()
        );
    }
    BOOL::from(true)
}

#[cfg(debug_assertions)]
fn dump_window_tree(frame: HWND) {
    eprintln!("[swallow-tree] ==== descendants of frame {:?} ====", frame.0);
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
        let mut launcher_h: Option<SendHWND> = None;
        let mut session_h: Option<SendHWND> = None;
        let total_attempts = 40; // 20 seconds to find the window (RDP/VDI baseline)

        for _i in 0..total_attempts {
            if let Some(h) = find_main_window(target_pid) {
                let h_wrap = SendHWND(h);
                let mut class_name_buf = [0u16; 256];
                let class_len = unsafe { GetClassNameW(h, &mut class_name_buf) };
                let class_str = String::from_utf16_lossy(&class_name_buf[..class_len as usize]);

                // Detailed session detection
                let is_session = class_str.contains("Blast") ||
                               class_str.contains("VMUI") ||
                               class_str.contains("TClient") ||
                               class_str.contains("TscShellContainerClass");

                if is_session {
                    session_h = Some(h_wrap);
                    break;
                } else if launcher_h.is_none() {
                    launcher_h = Some(h_wrap);
                    let _ = perform_swallow(&s_id, h_wrap, actual_parent, app.clone(), bounds);
                    // Launcher found, notify frontend but keep looking for session
                    let _ = app.emit("swallow-progress", s_id.clone());
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        if let Some(s_h) = session_h {
            let _ = perform_swallow(&s_id, s_h, actual_parent, app.clone(), bounds);
            let _ = app.emit("swallow-success", s_id.clone());
            if let Some(l_h) = launcher_h {
                if l_h.0 .0 != s_h.0 .0 {
                    unsafe {
                        let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(l_h.0, windows::Win32::UI::WindowsAndMessaging::SW_HIDE);
                    }
                }
            }
        } else if let Some(l_h) = launcher_h {
            let _ = perform_swallow(&s_id, l_h, actual_parent, app.clone(), bounds);
            let _ = app.emit("swallow-success", s_id.clone());
        } else {
            let _ = app.emit("swallow-failure", s_id.clone());
        }
    });

    Ok(())
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
        eprintln!("[swallow-tree] FRAME class='{}'", read_class(child_hwnd));
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

    // vmconnect: measure where the actual VM-video child sits inside the frame and
    // mask exactly that much chrome off the top, instead of the fixed 30px guess
    // (the real title+toolbar is taller, which is why the blue bar kept showing).
    let mut vmconnect_pid: Option<u32> = None;
    if class_str.to_lowercase().contains("vmconnect") {
        if let Some(vr) = find_vmconnect_video_rect(child_hwnd) {
            if vr.top > 0 && vr.top < 200 {
                offset = vr.top;
                #[cfg(debug_assertions)]
                eprintln!("[swallow-tree] vmconnect measured top chrome = {}px", offset);
            }
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
        if class_str.to_lowercase().contains("vmconnect") {
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
        });

        let _ = SetWindowPos(
            child_hwnd, HWND(std::ptr::null_mut()),
            x - HORIZONTAL_BUFFER, y - offset, width + (HORIZONTAL_BUFFER * 2), height + offset,
            SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOCOPYBITS
        );

        // Clip the non-removable toolbar/ribbon (e.g. VMConnect 30px ribbon).
        // The window is positioned at y-offset so rows 0..offset contain the ribbon.
        // SetWindowRgn masks those rows out, making only the content visible.
        if offset > 0 {
            let rgn = CreateRectRgn(0, offset, width + (HORIZONTAL_BUFFER * 2), height + offset);
            if !rgn.is_invalid() {
                let _ = SetWindowRgn(child_hwnd, rgn, BOOL::from(true));
            }
        }
    }

    let h_child_raw = child_hwnd.0 as isize;
    let h_parent_raw = actual_parent.0 as isize;
    let s_id = slot_id.to_string();
    let target_style = style;
    let target_ex_style = ex_style;
    let offset_cap = offset; // capture for stabilization loop
    let vmconnect_pid_cap = vmconnect_pid; // re-check the BBar each poll; it can reopen on focus/unmaximize

    std::thread::spawn(move || {
        // Adaptive backoff: apps fight hardest right after swallow, so poll fast
        // (100ms) then ease off to 1s once the window stays put. Any correction
        // resets to fast. Covers the same ~40s window as the old fixed 200×200ms
        // loop with a fraction of the wakeups once stable. ponytail: heuristic
        // backoff, swap for SetWinEventHook only if a real app still escapes.
        const FAST_MS: u64 = 100;
        const SLOW_MS: u64 = 1000;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(40);
        let mut interval_ms = FAST_MS;

        while std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(interval_ms));

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
                    let _ = SetWindowPos(
                        h_child,
                        HWND(std::ptr::null_mut()),
                        target_rect.0 - HORIZONTAL_BUFFER, target_rect.1 - offset_cap, target_rect.2 + (HORIZONTAL_BUFFER * 2), target_rect.3 + offset_cap,
                        SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE
                    );
                    // Re-apply ribbon clip region in case the app reset it
                    if offset_cap > 0 {
                        let rgn = CreateRectRgn(0, offset_cap, target_rect.2 + (HORIZONTAL_BUFFER * 2), target_rect.3 + offset_cap);
                        if !rgn.is_invalid() {
                            let _ = SetWindowRgn(h_child, rgn, BOOL::from(true));
                        }
                    }
                    interval_ms = FAST_MS; // app fought back — watch closely again
                } else {
                    interval_ms = (interval_ms * 2).min(SLOW_MS); // stable — ease off
                }
            }
        }
    });
    
    Ok(())
}

pub fn unswallow(slot_id: &str) -> Result<(), String> {
    let mut state = lock_state();
    if let Some(info) = state.remove(slot_id) {
        let child_hwnd = HWND(info.child_hwnd as *mut _);
        unsafe {
            if IsWindow(child_hwnd).as_bool() {
                let _ = SetParent(child_hwnd, HWND(std::ptr::null_mut()));
                let _ = SetWindowLongPtrW(child_hwnd, GWL_STYLE, info.original_style);
                let _ = SetWindowLongPtrW(child_hwnd, GWL_EXSTYLE, info.original_ex_style);
                if info.original_parent != 0 {
                     let _ = SetParent(child_hwnd, HWND(info.original_parent as *mut _));
                }
                // Detached session window stays alive ("세션 분리 — 창은 유지됨") but must
                // NOT slam down at 0,0 on top of HyperDesk. Apply the restored frame, give
                // it a sane size, then minimize to the taskbar: reachable, never overlapping.
                let _ = SetWindowPos(child_hwnd, HWND(std::ptr::null_mut()), 120, 120, 900, 650,
                    SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOZORDER);
                let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(
                    child_hwnd, windows::Win32::UI::WindowsAndMessaging::SW_SHOWMINNOACTIVE);
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
                    let offset = get_offset(&info.class_name);
                    let _ = SetWindowPos(
                        hwnd, HWND(std::ptr::null_mut()),
                        info.x - HORIZONTAL_BUFFER, info.y - offset, info.width + (HORIZONTAL_BUFFER * 2), info.height + offset,
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
                    let mut rect = RECT::default();
                    if GetWindowRect(hwnd, &mut rect).is_ok() {
                        let mut pt_tl = POINT { x: rect.left, y: rect.top };
                        let _ = ScreenToClient(p_hwnd, &mut pt_tl);
                        
                        let current_x = pt_tl.x;
                        let current_y = pt_tl.y;
                        let current_w = rect.right - rect.left;
                        let current_h = rect.bottom - rect.top;

                        // Precise filtering: Only move if the difference is > 1.5px (effectively 2px)
                        // This prevents internal rendering infinitesimal shifts from causing a loop.
                        if (current_x - x).abs() <= 1 && 
                           (current_y - y).abs() <= 1 && 
                           (current_w - width).abs() <= 1 && 
                           (current_h - height).abs() <= 1 {
                            return;
                        }
                    }

                    // Reuse the offset resolved at swallow time (info.offset), NOT
                    // get_offset(class_name) — that only returns the generic HYPERV_OFFSET
                    // fallback, not vmconnect's per-window MEASURED ribbon height. Using
                    // the wrong one here re-exposes the ribbon (or over-clips the video)
                    // on the very first resize after swallow.
                    let offset = info.offset;
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
                        x - HORIZONTAL_BUFFER, y - offset, width + (HORIZONTAL_BUFFER * 2), height + offset,
                        SWP_NOCOPYBITS | SWP_NOACTIVATE | SWP_NOOWNERZORDER
                    );
                }
            }
        }
    }
}

/// Forward keyboard focus to a swallowed window by slot ID.
/// Called from hotkey handlers and the focus_slot_window command.
pub fn focus_window(slot_id: &str) {
    let hwnd_raw = {
        let state = lock_state();
        state.get(slot_id).map(|info| info.child_hwnd)
    };
    if let Some(raw) = hwnd_raw {
        let hwnd = HWND(raw as *mut _);
        unsafe {
            if IsWindow(hwnd).as_bool() {
                let _ = SetForegroundWindow(hwnd);
                let _ = BringWindowToTop(hwnd);
            }
        }
    }
}
