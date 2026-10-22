pub mod models;
pub mod commands;
pub mod hosts;
pub mod swallow;
mod rdplink;

use commands::{
    get_vms, get_vm_ip, start_vm, stop_vm, save_vm, resume_vm,
    pause_vm, connect_vm, connect_console, get_dashboard, get_system_stats, create_vm,
    add_remote_host, remove_remote_host, update_remote_host,
    set_vm_memory, set_vm_processors, get_horizon_path, connect_horizon, check_host,
    set_window_visibility, is_window_valid, swallow_window,
    unswallow_window, sync_slot_bounds, set_header_cutout, toggle_fullscreen, set_fullscreen, quit_app, focus_slot_window,
    set_connect_lock, get_switch_lock,
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
    Manager,
};
// Alt+1~4 슬롯 전환은 swallow.rs의 LL 키보드 훅만 처리한다. 전역 단축키(RegisterHotKey)는
// 2026-10-20에 뺐다 — HyperDesk가 뒤에 있을 때도 발동해 다른 앱을 쓰는 중에 슬롯이 바뀌고
// (1.4.0부터는 포커스까지 뺏었다), 시스템 전체에서 Alt+1~4를 가로채 다른 앱이 못 받았다.
// HyperDesk나 세션 창이 앞에 있을 때는 LL 훅이 먼저 처리하므로 전역 단축키가 할 일이 없다.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // MUST be the first plugin. A second launch would stack another instance
        // fighting over the LL keyboard hook (Alt+1..4); it is
        // rejected here: the new process exits and we just re-show the existing window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            // 이미 떠 있는 상태에서 `rdp:` 링크를 누르면 새 프로세스는 여기서 거부되고,
            // 그 링크는 argv로 이쪽에 넘어온다.
            rdplink::accept_args(app, argv);
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // "이 rdp 링크를 열 앱" 선택지에 HyperDesk를 올린다(HKCU, 기본 앱은 안 빼앗음).
            // **release 빌드에서만.** 매 실행마다 자기 exe 경로로 덮어쓰므로 debug 빌드를
            // 한 번만 띄워도 `rdp:` 링크가 target\debug\hyperdesk.exe로 넘어가고, dev 서버가
            // 꺼져 있으면 "localhost 연결 거부" 화면이 떴다(2026-09-28). Store(MSIX) 설치본은
            // 이 HKCU 쓰기가 패키지 안으로 격리돼 효과가 없고, 대신 gen/windows/bundle.config.json의
            // protocolHandlers(→ AppxManifest의 windows.protocol)로 등록된다.
            #[cfg(not(debug_assertions))]
            if let Err(e) = rdplink::register_protocol() {
                crate::swallow::dlog(&format!("[rdplink] register failed: {e}"));
            }
            // 꺼져 있다가 `rdp:` 링크로 실행된 경우. 프론트가 준비되면 take_rdp_link로 가져간다.
            rdplink::accept_args(app.handle(), std::env::args().skip(1));
            // Must run before anything touches hosts.json/vm-tags.json/vm-memos.json —
            // see hosts.rs for why (2026-07 identifier change would otherwise silently
            // drop every existing user's data on update).
            hosts::migrate_legacy_app_data(app.handle());

            // Warm the resident PowerShell worker (Hyper-V module + CIM session,
            // ~1.1s) in parallel with WebView2/React boot, so the first dashboard
            // fetch hits a warm worker (~30ms) instead of paying the cold cost.
            commands::prewarm_ps_worker();

            // System tray setup
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "HyperDesk 열기", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("HyperDesk - VM Manager")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    // X와 같은 정리 순서 — exit(0)은 Destroyed의 정리를 못 기다린다.
                    "quit" => {
                        commands::restore_work_area();
                        swallow::unswallow_all();
                        app.exit(0);
                    }
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
                // X = 묻지 않고 완전 종료. exit(0)은 프로세스를 즉시 끝내서 Destroyed의
                // 정리가 안 돌 수 있으므로, swallow된 창 해제와 작업영역 원복을 먼저 한다
                // (안 하면 남의 프로세스 창이 죽어가는 부모에 붙은 채 남는다).
                tauri::WindowEvent::CloseRequested { .. } => {
                    commands::restore_work_area();
                    swallow::unswallow_all();
                    window.app_handle().exit(0);
                }
                tauri::WindowEvent::Destroyed => {
                    // 전체화면 상태로 종료돼도 넓혀둔 작업영역을 되돌린다.
                    commands::restore_work_area();
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
                // 세션 창은 메인 창이 소유한 최상위 창이라 스스로 따라오지 않는다.
                tauri::WindowEvent::Moved(_) => {
                    swallow::resync_positions();
                    commands::reassert_fullscreen_if_displaced(window);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            rdplink::take_rdp_link,
            rdplink::rdp_link_registered,
            rdplink::set_rdp_link,
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
            get_switch_lock,
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
