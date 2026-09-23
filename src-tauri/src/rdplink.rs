//! `rdp:` 링크 처리. HyperDesk를 Windows의 "이 rdp 링크를 열 앱" 목록에 올리고,
//! 그 링크로 실행되면 주소를 꺼내 프론트에 넘긴다(자산 추가 → 빈 슬롯에 연결은 프론트 몫).
//!
//! **보안 경계:** `rdp:` 링크는 웹페이지에서도 걸 수 있다. 파라미터를 그대로 믿으면
//! `drivestoredirect`(드라이브 공유), `alternate shell` 같은 걸 외부에서 주입할 수 있다.
//! 그래서 **주소와 사용자명만** 꺼내고 나머지는 전부 버리며, 둘 다 허용 문자만 통과시킨다.
//! 실제 `.rdp`는 기존 `connect_vm`이 우리 고정 설정(`authentication level:i:2` 등)으로 만든다.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct RdpLink {
    /// `host` 또는 `host:port` (IPv6는 `[..]:port`)
    pub host: String,
    pub username: Option<String>,
}

fn percent_decode(s: &str) -> String {
    // 바이트 단위로 본다 — `&s[i+1..i+3]` 같은 문자열 슬라이스는 `%` 뒤가 멀티바이트
    // 문자면 경계가 아니라서 패닉한다(외부 입력이라 그런 링크도 들어올 수 있다).
    let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h << 4 | l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 호스트는 DNS 이름/IPv4/IPv6(+포트)에 쓰이는 문자만 허용한다. 공백·따옴표·줄바꿈·
/// `;` 같은 게 섞이면 `.rdp` 지시어 주입이나 명령줄 인자 오염으로 이어질 수 있다.
fn valid_host(h: &str) -> bool {
    !h.is_empty()
        && h.len() <= 255
        && h.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']'))
}

/// 사용자명은 `DOMAIN\user`, `user@domain` 형태까지만 허용한다.
fn valid_user(u: &str) -> bool {
    !u.is_empty()
        && u.len() <= 256
        && u.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '@' | '\\'))
}

/// `rdp://full%20address=s:host:3389&username=s:bob&…` 또는 `rdp://host[:port]`를 해석한다.
/// 허용 목록 밖의 파라미터는 조용히 버린다. 주소가 없거나 이상하면 None.
pub fn parse_rdp_uri(uri: &str) -> Option<RdpLink> {
    let lower = uri.to_ascii_lowercase();
    if !lower.starts_with("rdp:") {
        return None;
    }
    let body = uri[4..].trim_start_matches('/');
    let body = percent_decode(body);
    let body = body.trim_end_matches('/');

    let (mut host, mut username) = (None::<String>, None::<String>);
    if body.contains('=') {
        for pair in body.split('&') {
            let Some((k, v)) = pair.split_once('=') else { continue };
            // 값은 `s:값` / `i:값` 형식 — 타입 접두사를 떼어낸다.
            let v = v.split_once(':').filter(|(t, _)| t.len() == 1).map(|(_, rest)| rest).unwrap_or(v);
            match k.trim().to_ascii_lowercase().as_str() {
                "full address" => host = Some(v.trim().to_string()),
                "username" => username = Some(v.trim().to_string()),
                _ => {} // 허용 목록 밖 — 버린다
            }
        }
    } else {
        host = Some(body.trim().to_string());
    }

    let host = host.filter(|h| valid_host(h))?;
    Some(RdpLink { host, username: username.filter(|u| valid_user(u)) })
}

static PENDING: Mutex<Option<RdpLink>> = Mutex::new(None);

/// 실행 인자에서 `rdp:` 링크를 찾아 대기열에 넣고 프론트에 알린다. 앱이 이미 떠 있으면
/// single-instance 콜백의 argv로, 새로 뜰 때는 `std::env::args()`로 들어온다.
/// 프론트가 아직 준비 전일 수 있어서 이벤트만 쏘지 않고 대기열에 보관한다 —
/// 프론트는 마운트 시와 이벤트 수신 시 모두 `take_rdp_link`로 가져간다.
pub fn accept_args<I: IntoIterator<Item = String>>(app: &AppHandle, args: I) {
    if let Some(link) = args.into_iter().find_map(|a| parse_rdp_uri(&a)) {
        *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(link);
        let _ = app.emit("rdp-link", ());
    }
}

#[tauri::command]
pub fn take_rdp_link() -> Option<RdpLink> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// Windows에 "HyperDesk도 `rdp:` 링크를 열 수 있다"고 알린다. 전부 HKCU라 관리자 권한이
/// 필요 없다. **기본 앱을 빼앗지 않는다** — `HKCU\Software\Classes\rdp`에 우리 명령을 직접
/// 쓰면 묻지 않고 가로채게 되므로, Default Programs 방식(Capabilities + RegisteredApplications)
/// 으로 **선택지에만** 오른다. 어떤 앱을 쓸지는 사용자가 저 선택 창에서 고른다.
/// 매 실행마다 덮어써서 실행 파일 경로가 바뀌어도(업데이트·재설치) 스스로 복구된다.
pub fn register_protocol() -> std::io::Result<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let exe = std::env::current_exe()?;
    let exe = exe.to_string_lossy();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let (prog, _) = hkcu.create_subkey(r"Software\Classes\HyperDesk.rdp")?;
    prog.set_value("", &"RDP 연결 (HyperDesk)")?;
    prog.set_value("URL Protocol", &"")?;
    let (icon, _) = prog.create_subkey("DefaultIcon")?;
    icon.set_value("", &format!("\"{exe}\",0"))?;
    let (cmd, _) = prog.create_subkey(r"shell\open\command")?;
    cmd.set_value("", &format!("\"{exe}\" \"%1\""))?;

    let (caps, _) = hkcu.create_subkey(r"Software\HyperDesk\Capabilities")?;
    caps.set_value("ApplicationName", &"HyperDesk")?;
    caps.set_value("ApplicationDescription", &"Hyper-V · 원격 데스크톱 통합 관리")?;
    let (urls, _) = caps.create_subkey("URLAssociations")?;
    urls.set_value("rdp", &"HyperDesk.rdp")?;

    let (reg_apps, _) = hkcu.create_subkey(r"Software\RegisteredApplications")?;
    reg_apps.set_value("HyperDesk", &r"Software\HyperDesk\Capabilities")?;

    // `rdp:` 스킴 자체가 시스템에 선언돼 있지 않으면 Windows가 이걸 URL로 취급하지 않아
    // 선택 창에 우리 앱을 못 띄운다. 이미 있으면(다른 앱 소유) **건드리지 않고**, 없을
    // 때만 명령 없이 스킴만 선언한다 — 여는 앱은 여전히 사용자가 고른다.
    if hkcu.open_subkey(r"Software\Classes\rdp").is_err() {
        let (scheme, _) = hkcu.create_subkey(r"Software\Classes\rdp")?;
        scheme.set_value("", &"URL:Remote Desktop Protocol")?;
        scheme.set_value("URL Protocol", &"")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_rdp_uri, RdpLink};

    fn link(host: &str, user: Option<&str>) -> Option<RdpLink> {
        Some(RdpLink { host: host.into(), username: user.map(Into::into) })
    }

    #[test]
    fn parses_ms_rdp_uri_format() {
        assert_eq!(
            parse_rdp_uri("rdp://full%20address=s:srv01.corp.local:3389&username=s:CORP%5Cbob&audiomode=i:2"),
            link("srv01.corp.local:3389", Some(r"CORP\bob"))
        );
        assert_eq!(parse_rdp_uri("RDP://full address=s:10.0.0.5"), link("10.0.0.5", None));
    }

    #[test]
    fn parses_bare_host_form() {
        assert_eq!(parse_rdp_uri("rdp://10.1.2.3:3390/"), link("10.1.2.3:3390", None));
        assert_eq!(parse_rdp_uri("rdp:[fe80::1]:3389"), link("[fe80::1]:3389", None));
    }

    /// 웹페이지에서 걸린 링크가 위험한 지시어를 실어 보내도 주소·사용자명 외엔 전부 버린다.
    #[test]
    fn drops_everything_outside_the_allowlist() {
        let l = parse_rdp_uri(
            "rdp://full%20address=s:host&drivestoredirect=s:*&alternate%20shell=s:cmd.exe&authentication%20level=i:0",
        );
        assert_eq!(l, link("host", None));
    }

    /// `.rdp`는 줄 단위라 줄바꿈이 섞이면 지시어가 주입된다. 호스트가 오염됐으면 링크 전체를 거부.
    #[test]
    fn rejects_injection_in_host_and_drops_bad_username() {
        assert_eq!(parse_rdp_uri("rdp://full%20address=s:host%0Aalternate%20shell:s:cmd"), None);
        assert_eq!(parse_rdp_uri("rdp://full%20address=s:ho%20st"), None);
        assert_eq!(parse_rdp_uri("rdp://full%20address=s:host\"%20-x"), None);
        assert_eq!(
            parse_rdp_uri("rdp://full%20address=s:host&username=s:bob%0Aalternate"),
            link("host", None),
            "사용자명이 오염되면 사용자명만 버리고 연결 자체는 허용"
        );
    }

    /// `%` 뒤에 멀티바이트 문자가 와도 패닉하지 않는다(외부 입력).
    #[test]
    fn survives_multibyte_after_percent() {
        assert_eq!(parse_rdp_uri("rdp://full%20address=s:host%한"), None);
        assert_eq!(parse_rdp_uri("rdp://호스트"), None);
    }

    #[test]
    fn ignores_non_rdp_and_empty() {
        assert_eq!(parse_rdp_uri("C:\\Program Files\\HyperDesk\\hyperdesk.exe"), None);
        assert_eq!(parse_rdp_uri("--flag"), None);
        assert_eq!(parse_rdp_uri("rdp://"), None);
        assert_eq!(parse_rdp_uri("rdp://audiomode=i:2"), None);
    }
}
