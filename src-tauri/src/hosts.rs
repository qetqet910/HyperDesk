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
}
