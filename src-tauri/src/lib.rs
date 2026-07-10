pub mod models;
pub mod commands;
pub mod hosts;
pub mod swallow;

use commands::{
    get_vms, get_vm_ip, start_vm, stop_vm, save_vm, resume_vm,
    pause_vm, connect_vm, connect_console, get_dashboard, get_system_stats,
    add_remote_host, remove_remote_host, update_remote_host,
    set_vm_memory, set_vm_processors, get_horizon_path, connect_horizon, check_host,
    set_window_visibility, is_window_valid, swallow_window,
    unswallow_window, sync_slot_bounds, toggle_fullscreen, set_fullscreen, set_immersive, flash_immersive_header, quit_app, focus_slot_window,
    list_snapshots, create_snapshot, restore_snapshot, delete_snapshot,
    get_vm_memo, set_vm_memo, set_remote_host_memo,
    get_vm_tags, set_vm_tags, set_remote_host_tags,
    get_vm_checkpoints, checkpoint_vm, restore_vm_checkpoint, delete_vm_checkpoint,
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
            if shortcut.mods.contains(Modifiers::ALT) {
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
            // Warm the resident PowerShell worker (Hyper-V module + CIM session,
            // ~1.1s) in parallel with WebView2/React boot, so the first dashboard
            // fetch hits a warm worker (~30ms) instead of paying the cold cost.
            commands::prewarm_ps_worker();

            // Register global hotkeys at startup (not just on focus)
            let shortcuts = app.global_shortcut();
            // Clear any stale registrations (e.g. a previous dev instance / zombie
            // process that didn't release the OS-level hotkey) before registering,
            // so register() doesn't fail with "already registered".
            let _ = shortcuts.unregister_all();
            for (name, code) in [
                ("Alt+1", Code::Digit1), ("Alt+2", Code::Digit2),
                ("Alt+3", Code::Digit3), ("Alt+4", Code::Digit4),
            ] {
                match shortcuts.register(Shortcut::new(Some(Modifiers::ALT), code)) {
                    Ok(()) => eprintln!("[hotkey] registered {name}"),
                    // A global shortcut that's already owned by another app fails HERE —
                    // silently before. If you see this for Alt+1..4, another program holds it.
                    Err(e) => eprintln!("[hotkey] FAILED to register {name}: {e}"),
                }
            }

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
                    swallow::unswallow_all();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_dashboard,
            get_system_stats,
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
            get_vms,
            get_vm_ip,
            set_window_visibility,
            is_window_valid,
            toggle_fullscreen,
            set_fullscreen,
            set_immersive,
            flash_immersive_header,
            quit_app,
            focus_slot_window,
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
