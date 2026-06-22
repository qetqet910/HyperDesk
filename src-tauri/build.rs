fn main() {
    // ponytail: HYPERDESK_E2E=1 swaps in a no-admin manifest so tauri-driver/msedgedriver
    // can launch the app without a UAC prompt blocking the WebDriver session.
    // Match the value strictly (== "1"), not merely is_ok(): a stale/empty
    // HYPERDESK_E2E lingering in the environment must NOT silently strip admin
    // elevation from a normal build, or SetParent window-swallowing dies without
    // an error.
    let manifest = if std::env::var("HYPERDESK_E2E").as_deref() == Ok("1") {
        include_str!("hyperdesk-e2e.exe.manifest")
    } else {
        include_str!("hyperdesk.exe.manifest")
    };
    println!("cargo:rerun-if-env-changed=HYPERDESK_E2E");

    let mut windows_attributes = tauri_build::WindowsAttributes::new();
    windows_attributes = windows_attributes.app_manifest(manifest);
    
    let attributes = tauri_build::Attributes::new().windows_attributes(windows_attributes);
    
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
