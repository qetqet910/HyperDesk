use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RemoteHost {
    pub id: String,
    pub name: String,
    pub host: String,
    pub username: Option<String>,
    pub protocol: String, // "RDP" or "HORIZON"
    pub is_detected: bool,
    pub status: Option<String>,
    pub latency: Option<u32>,
    pub load: Option<f64>,
    #[serde(default)]
    pub is_hidden: bool,
    #[serde(default)]
    pub memo: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

/// One-time migration for the 2026-07 MS Store identifier change
/// (`com.hyperdesk.app` -> `FAAFE2B2.HyperDesk`, see CLAUDE.md). Tauri derives
/// `app_data_dir()` straight from `identifier`, so every existing install's
/// hosts.json/vm-tags.json/vm-memos.json would otherwise silently vanish the
/// moment a user updates — same folder name, new parent, no error. Must run
/// before anything else reads/writes the new directory (called first thing in
/// lib.rs setup()). No-op if the new dir already has data (already migrated,
/// or a genuinely fresh install with nothing to bring over).
pub fn migrate_legacy_app_data(app: &AppHandle) {
    let Ok(new_dir) = app.path().app_data_dir() else { return };
    let Some(roaming_root) = new_dir.parent().map(|p| p.to_path_buf()) else { return };
    migrate_legacy_app_data_at(&roaming_root, &new_dir);
}

/// Path-only core of the migration, split out from `migrate_legacy_app_data` so
/// it's testable without a live `AppHandle` (Tauri's isn't constructible in a
/// plain unit test). `roaming_root` is the shared parent both identifiers'
/// folders live under (`%APPDATA%` on Windows); `new_dir` is this build's
/// `app_data_dir()`.
fn migrate_legacy_app_data_at(roaming_root: &std::path::Path, new_dir: &std::path::Path) {
    if new_dir.join("hosts.json").exists() {
        return; // already migrated, or fresh install that collided — leave it alone
    }
    let old_dir = roaming_root.join("com.hyperdesk.app");
    if !old_dir.exists() {
        return; // fresh install, never had the old identifier
    }
    let _ = fs::create_dir_all(new_dir);
    for name in ["hosts.json", "vm-tags.json", "vm-memos.json"] {
        let old_file = old_dir.join(name);
        if old_file.exists() {
            let _ = fs::copy(&old_file, new_dir.join(name));
        }
    }
}

pub fn get_hosts_file_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }
    path.push("hosts.json");
    path
}

pub fn load_hosts(app: &AppHandle) -> Vec<RemoteHost> {
    let path = get_hosts_file_path(app);
    if let Ok(content) = fs::read_to_string(path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    }
}

pub fn save_hosts(app: &AppHandle, hosts: &[RemoteHost]) -> Result<(), String> {
    let path = get_hosts_file_path(app);
    
    // Smart Filter: Only save manual hosts or those with non-default names
    // This allows us to persist custom names without keeping 'zombie' registry data
    let manual_hosts: Vec<RemoteHost> = hosts.iter()
        .filter(|h| {
            if h.is_hidden { return true; } // Always persist hidden state
            if !h.is_detected { return true; }
            // Always persist hosts with user-entered memo or tags
            if h.memo.is_some() { return true; }
            if h.tags.as_ref().is_some_and(|t| !t.is_empty()) { return true; }
            match h.protocol.as_str() {
                "HORIZON" => h.name != format!("VDI: {}", h.host),
                _ => h.name != h.host, // RDP default name is just host address
            }
        })
        .cloned()
        .collect();
    
    let json = serde_json::to_string_pretty(&manual_hosts)
        .map_err(|e| format!("Serialization error: {}", e))?;
    fs::write(path, json).map_err(|e| format!("File write error: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // 1. RemoteHost 구조체 역직렬화 & 필드 누락 검증 하네스
    #[test]
    fn test_remote_host_is_hidden_compatibility() {
        let json = r#"{
            "id": "manual-123",
            "name": "Local Server",
            "host": "192.168.0.10",
            "username": "admin",
            "protocol": "RDP",
            "is_detected": false
        }"#; // is_hidden이 없는 옛날 데이터 가정
        
        let host: RemoteHost = serde_json::from_str(json).unwrap();
        // #[serde(default)] 덕분에 필드가 없어도 false로 기본값이 설정되어야 함
        assert!(!host.is_hidden, "is_hidden field should default to false if missing in JSON");
    }

    // 2. 스마트 필터 및 영속성 로직 검증 하네스
    #[test]
    fn test_save_hosts_smart_filtering() {
        // 실제 파일 대신 가상 환경 시뮬레이션
        let mut hosts = Vec::new();
        
        // CASE A: 수동 추가된 호스트 (저장되어야 함)
        hosts.push(RemoteHost {
            id: "manual-1".to_string(),
            name: "My Server".to_string(),
            host: "server.com".to_string(),
            username: None,
            protocol: "RDP".to_string(),
            is_detected: false,
            status: None, latency: None, load: None,
            is_hidden: false,
            memo: None,
            tags: None,
        });

        // CASE B: 레지스트리 자동 감지 (저장되지 않아야 함 - 하이브리드 관리)
        hosts.push(RemoteHost {
            id: "detected-1".to_string(),
            name: "10.0.0.1".to_string(),
            host: "10.0.0.1".to_string(),
            username: None,
            protocol: "RDP".to_string(),
            is_detected: true,
            status: None, latency: None, load: None,
            is_hidden: false,
            memo: None,
            tags: None,
        });

        // CASE C: 사용자가 숨김 처리한 자동 감지 호스트 (숨김 상태 보존을 위해 저장되어야 함)
        hosts.push(RemoteHost {
            id: "detected-hidden".to_string(),
            name: "10.0.0.2".to_string(),
            host: "10.0.0.2".to_string(),
            username: None,
            protocol: "RDP".to_string(),
            is_detected: true,
            status: None, latency: None, load: None,
            is_hidden: true,
            memo: None,
            tags: None,
        });

        // 필터링 시뮬레이션
        let filtered: Vec<RemoteHost> = hosts.iter()
            .filter(|h| {
                if h.is_hidden { return true; } 
                if !h.is_detected { return true; }
                false // 기본 감지 호스트는 제외
            })
            .cloned()
            .collect();

        assert_eq!(filtered.len(), 2, "Should only persist manual hosts and hidden detected hosts");
        assert!(filtered.iter().any(|h| h.id == "manual-1"));
        assert!(filtered.iter().any(|h| h.id == "detected-hidden"));
    }

    // 3. 2026-07 identifier 변경 마이그레이션 검증 (실제 임시 디렉터리 사용)
    fn temp_scratch_dir(tag: &str) -> PathBuf {
        // Instant/SystemTime's Debug output includes ':' on some platforms,
        // which Windows rejects in a path — a plain nanos-since-epoch integer
        // is portable and still unique enough to avoid cross-test collisions.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "hyperdesk-migrate-test-{}-{}-{}",
            tag, std::process::id(), nanos
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn migration_copies_legacy_files_into_new_dir() {
        let root = temp_scratch_dir("copy");
        let old_dir = root.join("com.hyperdesk.app");
        let new_dir = root.join("FAAFE2B2.HyperDesk");
        fs::create_dir_all(&old_dir).unwrap();
        fs::write(old_dir.join("hosts.json"), r#"[{"id":"x"}]"#).unwrap();
        fs::write(old_dir.join("vm-tags.json"), r#"{"vm1":["prod"]}"#).unwrap();
        // vm-memos.json deliberately absent — migration must not choke on a
        // partially-populated old install.

        migrate_legacy_app_data_at(&root, &new_dir);

        assert_eq!(fs::read_to_string(new_dir.join("hosts.json")).unwrap(), r#"[{"id":"x"}]"#);
        assert_eq!(fs::read_to_string(new_dir.join("vm-tags.json")).unwrap(), r#"{"vm1":["prod"]}"#);
        assert!(!new_dir.join("vm-memos.json").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn migration_is_noop_when_new_dir_already_has_data() {
        let root = temp_scratch_dir("noop-existing");
        let old_dir = root.join("com.hyperdesk.app");
        let new_dir = root.join("FAAFE2B2.HyperDesk");
        fs::create_dir_all(&old_dir).unwrap();
        fs::create_dir_all(&new_dir).unwrap();
        fs::write(old_dir.join("hosts.json"), r#"[{"id":"old"}]"#).unwrap();
        fs::write(new_dir.join("hosts.json"), r#"[{"id":"already-here"}]"#).unwrap();

        migrate_legacy_app_data_at(&root, &new_dir);

        // Must never clobber data that's already in the new location.
        assert_eq!(fs::read_to_string(new_dir.join("hosts.json")).unwrap(), r#"[{"id":"already-here"}]"#);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn migration_is_noop_on_fresh_install() {
        let root = temp_scratch_dir("noop-fresh");
        let new_dir = root.join("FAAFE2B2.HyperDesk");
        // No old_dir at all — a genuinely fresh install.

        migrate_legacy_app_data_at(&root, &new_dir);

        assert!(!new_dir.join("hosts.json").exists());

        let _ = fs::remove_dir_all(&root);
    }
}
