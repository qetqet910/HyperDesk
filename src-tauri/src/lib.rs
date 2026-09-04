pub mod models;
pub mod commands;
pub mod hosts;
pub mod swallow;

use commands::{
    get_vms, get_vm_ip, start_vm, stop_vm, save_vm, resume_vm,
    pause_vm, connect_vm, connect_console, get_dashboard, get_system_stats, create_vm,
    add_remote_host, remove_remote_host, update_remote_host,
    set_vm_memory, set_vm_processors, get_horizon_path, connect_horizon, check_host,
    set_window_visibility, is_window_valid, swallow_window, set_hotkey_modifier,
    unswallow_window, sync_slot_bounds, set_header_cutout, toggle_fullscreen, set_fullscreen, quit_app, focus_slot_window,
    set_connect_lock,
    list_snapshots, create_snapshot, restore_snapshot, delete_snapshot,
    get_vm_memo, set_vm_memo, set_remote_host_memo,
    get_vm_tags, set_vm_tags, set_remote_host_tags,
    get_vm_checkpoints, checkpoint_vm, restore_vm_checkpoint, delete_vm_checkpoint,
    get_vm_disk_info, compact_vm_disk, convert_vm_disk_to_dynamic,
    get_vm_switches, get_vm_network_adapters,
    get_hyper_v_events,
    get_data_dir_path, reset_hidden_hosts, clear_app_data,
};
#[cfg(debug_assertions)]
use commands::debug_spawn_test_window;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, Emitter,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Modifiers, Code};

/// 슬롯 전환 단축키(수정자+1~4)를 현재 설정값으로 (재)등록한다.
///
/// 설정에서 수정자를 바꿀 때도 이 함수를 다시 부른다 — 등록 로직이 두 곳에 있으면
/// 한쪽만 고쳐져 "설정은 바뀌었는데 옛 키가 계속 먹는" 상태가 된다.
pub(crate) fn register_slot_hotkeys(app: &tauri::AppHandle) {
    let shortcuts = app.global_shortcut();
    // 이전 등록을 먼저 지운다 — 안 지우면 옛 수정자가 계속 살아 있고,
    // 재등록도 "already registered"로 실패한다.
    let _ = shortcuts.unregister_all();
    let m = commands::hotkey_mod().lock().map(|g| g.clone()).unwrap_or_else(|e| e.into_inner().clone());
    let mods = match m.as_str() {
        "ctrl" => Modifiers::CONTROL,
        "shift" => Modifiers::SHIFT,
        "super" => Modifiers::SUPER,
        _ => Modifiers::ALT,
    };
    for (n, code) in [(1, Code::Digit1), (2, Code::Digit2), (3, Code::Digit3), (4, Code::Digit4)] {
        match shortcuts.register(Shortcut::new(Some(mods), code)) {
            Ok(()) => crate::swallow::dlog(&format!("[hotkey] registered {m}+{n}")),
            // 다른 앱이 이미 잡고 있으면 여기서 실패한다 — 조용히 안 먹는 것보다
            // 로그로 드러나는 게 낫다(사용자가 다른 수정자로 바꾸면 된다).
            Err(e) => crate::swallow::dlog(&format!("[hotkey] FAILED {m}+{n}: {e}")),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // MUST be the first plugin. A second launch (tray app — closing the window
        // only hides it, so the process lingers and the next launch would stack
        // another instance fighting over the global Alt+1..4 hotkeys) is rejected
        // here: the new process exits and we just re-show the existing window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app: &tauri::AppHandle, shortcut: &Shortcut, _event| {
            // MultiView.tsx mirrors its `anyConnecting` lock into this flag via
            // set_connect_lock — switching slots mid-swallow breaks the embed, and
            // this handler runs natively with no visibility into React state, so
            // it must consult the flag itself rather than trust the frontend to
            // ignore the emitted event.
            if shortcut.mods.contains(Modifiers::ALT) && !crate::swallow::is_connect_locked() {
                match shortcut.key {
                    Code::Digit1 => {
                        let _ = app.emit("hotkey-focus", "slot-0");
                        crate::swallow::focus_window("slot-0");
                    }
                    Code::Digit2 => {
                        let _ = app.emit("hotkey-focus", "slot-1");
                        crate::swallow::focus_window("slot-1");
                    }
                    Code::Digit3 => {
                        let _ = app.emit("hotkey-focus", "slot-2");
                        crate::swallow::focus_window("slot-2");
                    }
                    Code::Digit4 => {
                        let _ = app.emit("hotkey-focus", "slot-3");
                        crate::swallow::focus_window("slot-3");
                    }
                    _ => {}
                }
            }
        }).build())
        .setup(|app| {
            // Must run before anything touches hosts.json/vm-tags.json/vm-memos.json —
            // see hosts.rs for why (2026-07 identifier change would otherwise silently
            // drop every existing user's data on update).
            hosts::migrate_legacy_app_data(app.handle());

            // Warm the resident PowerShell worker (Hyper-V module + CIM session,
            // ~1.1s) in parallel with WebView2/React boot, so the first dashboard
            // fetch hits a warm worker (~30ms) instead of paying the cold cost.
            commands::prewarm_ps_worker();

            // Register global hotkeys at startup (not just on focus)
            let shortcuts = app.global_shortcut();
            // Clear any stale registrations (e.g. a previous dev instance / zombie
            // process that didn't release the OS-level hotkey) before registering,
            // so register() doesn't fail with "already registered".
            let _ = shortcuts;
            register_slot_hotkeys(app.handle());

            // System tray setup
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "HyperDesk 열기", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("HyperDesk - VM Manager")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Win-key/Alt+Tab/Alt+1~4 → focused VM (see swallow.rs keyboard-hook section).
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(h) = win.hwnd() {
                    crate::swallow::install_keyboard_hook(app.handle().clone(), h.0 as isize);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                #[allow(unused_variables)]
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Dev: actually exit immediately, otherwise every `tauri dev`
                    // restart leaves a zombie holding the global Alt+1..4 hotkeys, so
                    // the next instance fails to register them. No confirmation here —
                    // it would have to be clicked through on every dev reload.
                    #[cfg(debug_assertions)]
                    {
                        // Unparent swallowed children before exit — exit(0) kills the
                        // process immediately and Destroyed's unswallow_all() may not run.
                        commands::set_taskbar_autohide(false);
                        swallow::unswallow_all();
                        window.app_handle().exit(0);
                    }
                    // Production: never close silently to tray. Prevent the close and
                    // ask the frontend first (ConfirmModal) — the user picks tray vs.
                    // cancel; "quit for real" is still reachable from the tray menu.
                    #[cfg(not(debug_assertions))]
                    {
                        api.prevent_close();
                        let _ = window.emit("close-requested", ());
                    }
                }
                // Shortcuts are registered once in setup() and stay registered for the
                // app's lifetime (global, so they fire even while a swallowed native
                // window has focus). Re-registering on every Focused event only threw
                // "already registered" and left them broken — removed.
                tauri::WindowEvent::Destroyed => {
                    // 전체화면 상태로 종료돼도 사용자 작업표시줄 설정을 되돌린다.
                    commands::set_taskbar_autohide(false);
                    swallow::unswallow_all();
                }
                // Native maximize()/restore on this decorations:false window needs the
                // same shell fullscreen mark F11 uses, or the taskbar draws over the
                // last ~40px at the bottom (and a few px on the right) once maximized —
                // see commands::sync_fullscreen_mark_for_maximize.
                tauri::WindowEvent::Resized(_) => {
                    commands::sync_fullscreen_mark_for_maximize(window);
                    // 최소화 → 복원. 그 사이 자식의 스타일/부모는 하나도 안 바뀌므로
                    // 안정화 루프가 아무것도 안 하고(needs_refresh=false), 결과적으로
                    // swallow된 세션에 "다시 그려라"라고 말하는 주체가 없어 검은 화면으로
                    // 남는다. 동시에 최소화/복원은 셸의 전체화면 재평가 트리거라 F11
                    // 중이었다면 작업표시줄도 다시 올라온다. 둘 다 여기서 복구한다.
                    commands::sync_restore_from_minimize(window);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_dashboard,
            get_system_stats,
            create_vm,
            add_remote_host,
            remove_remote_host,
            update_remote_host,
            start_vm,
            stop_vm,
            save_vm,
            resume_vm,
            pause_vm,
            connect_vm,
            connect_console,
            connect_horizon,
            check_host,
            set_vm_memory,
            set_vm_processors,
            get_horizon_path,
            swallow_window,
            unswallow_window,
            sync_slot_bounds,
            set_header_cutout,
            get_vms,
            get_vm_ip,
            set_window_visibility,
            is_window_valid,
            toggle_fullscreen,
            set_fullscreen,
            quit_app,
            focus_slot_window,
            set_connect_lock,
            set_hotkey_modifier,
            list_snapshots,
            create_snapshot,
            restore_snapshot,
            delete_snapshot,
            get_vm_memo,
            set_vm_memo,
            set_remote_host_memo,
            get_vm_tags,
            set_vm_tags,
            set_remote_host_tags,
            get_vm_checkpoints,
            checkpoint_vm,
            restore_vm_checkpoint,
            delete_vm_checkpoint,
            get_vm_disk_info,
            compact_vm_disk,
            convert_vm_disk_to_dynamic,
            get_vm_switches,
            get_vm_network_adapters,
            get_hyper_v_events,
            get_data_dir_path,
            reset_hidden_hosts,
            clear_app_data,
            #[cfg(debug_assertions)]
            debug_spawn_test_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HyperDesk");
}
