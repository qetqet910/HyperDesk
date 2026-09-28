; HyperDesk NSIS 설치 훅 (tauri.conf.json bundle.windows.nsis.installerHooks)

; 제거 시 `rdp:` 링크 선택지 등록을 지운다. 등록은 앱이 실행될 때마다
; rdplink.rs register_protocol()이 HKCU에 쓴다.
; `Software\Classes\rdp` 스킴 키는 지우지 않는다 — 우리가 만든 것인지 다른 앱
; (MS 원격 데스크톱 등)이 만든 것인지 구분할 수 없고, 남아도 명령이 없어 무해하다.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\HyperDesk.rdp"
  DeleteRegKey HKCU "Software\HyperDesk\Capabilities"
  DeleteRegKey /ifempty HKCU "Software\HyperDesk"
  DeleteRegValue HKCU "Software\RegisteredApplications" "HyperDesk"
!macroend
