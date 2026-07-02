---
name: swallow-debug-file-logging
description: swallow 디버깅 시 stderr 대신 파일 로그를 쓰는 이유와 방법
metadata:
  type: project
---

HyperDesk swallow 디버깅은 콘솔 stderr로 안 된다. 앱이 `requireAdministrator` manifest라 일반 터미널에서 `npm run tauri dev` 하면 UAC가 새 elevated 프로세스를 띄우고 stderr가 원래 콘솔과 분리된다(프롬프트가 즉시 돌아오고 로그가 텅 빔). 관리자 터미널에서 띄워도 cargo 자식 프로세스 분리로 새기 쉽다.

해결법 (현재 코드엔 없음 — 디버깅 때 다시 추가하는 패턴): `swallow.rs`에 dev 한정 `dlog!` 매크로를 두고 `%TEMP%\hyperdesk-swallow.log`에 append. 권한/콘솔 분리와 무관하게 파일에 남는다. 사용법:
- `Remove-Item $env:TEMP\hyperdesk-swallow.log` 로 비우고
- `npm run tauri dev` (관리자) → 재현 →
- `Get-Content $env:TEMP\hyperdesk-swallow.log`

**Why:** elevation 때문에 콘솔 로그를 못 봐서 디버깅이 막힌다.
**How to apply:** swallow 관련 진단 필요 시 `eprintln!` 대신 `dlog!`로 찍게 하고 파일에서 읽는다. 단 BBar 재숨김처럼 매 폴마다 도는 지점에 dlog를 걸면 로그가 폭주하니, 출시 전엔 dlog 호출을 줄이거나 제거. 관련: [[swallow-resize-is-rdp-limit]]
