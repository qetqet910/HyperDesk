# 개인정보 및 데이터 처리 안내

HyperDesk가 PC에서 무엇을 읽고, 무엇을 저장하고, 어디와 통신하는지 정리한 문서입니다.
HyperDesk는 무료 소프트웨어이며 **사용 통계·분석·광고 데이터를 수집하지 않고, 개발자 서버로
어떤 데이터도 보내지 않습니다.**

## 읽는 데이터

| 데이터 | 출처 | 용도 |
|---|---|---|
| 원격 데스크톱 접속 기록(호스트 이름) | `HKCU\Software\Microsoft\Terminal Server Client\Servers` | 대시보드에 원격 호스트 자동 표시 |
| Horizon/Omnissa 서버 목록 | `HKCU\Software\VMware\…`, `HKCU\Software\Omnissa\…` | 대시보드에 VDI 호스트 자동 표시 |
| Hyper-V VM 목록·상태·IP | PowerShell(`Get-VM` 등) | VM 모니터링과 제어 |
| 시스템 자원(CPU·메모리·디스크·네트워크 사용량) | Windows API | 대시보드 그래프 |
| Hyper-V 이벤트(최근 50건, 첫 줄만) | Windows 이벤트 로그 `Microsoft-Windows-Hyper-V-Worker-Admin`, `…-VMMS-Operational`, `…-VMMS-Admin` | 이벤트 로그 화면 — 그 화면을 열 때만 읽음 |

자동 새로고침(설정 → 모니터링, 기본 켜짐)이 켜져 있으면 설정한 주기(기본 10초, 2~300초)마다
VM·원격 호스트 상태를 다시 읽고, CPU·메모리 그래프는 2초마다 읽습니다. 끄면 앱 창을 다시 볼 때만
읽습니다. 앱을 닫으면 아무것도 읽지 않으며, 백그라운드 서비스는 설치하지 않습니다.

## 저장하는 데이터

모두 **이 PC 안에만** 저장됩니다.

| 데이터 | 위치 |
|---|---|
| 직접 추가·수정한 호스트(이름, 주소, 사용자 이름, 메모) | 앱 데이터 폴더의 `hosts.json` |
| VM 태그·메모 | 앱 데이터 폴더의 `vm-tags.json`, `vm-memos.json` |
| 화면 설정(테마, 사이드바, 슬롯 배치 등) | 앱 내부 웹뷰 저장소 |
| RDP 연결 파일(호스트와 사용자 이름) | `%TEMP%`의 임시 `.rdp` 파일 — 연결을 시작하고 10초 뒤 삭제 |
| 진단 로그(전체화면 위치 보정, 단축키 판정 이상 등 드물게 몇 줄 — 입력한 내용은 기록하지 않음) | `%TEMP%\hyperdesk-swallow.log` |

앱 데이터 폴더는 `%APPDATA%\FAAFE2B2.HyperDesk`입니다. Microsoft Store 설치본은 Windows가
이 폴더를 앱 전용 공간으로 옮겨 관리하므로, 앱을 제거하면 함께 지워집니다.

**비밀번호는 저장하지 않습니다.** 원격 데스크톱 로그인은 Windows 원격 데스크톱 연결(mstsc)이나
Horizon 클라이언트가 직접 처리하며, 그 프로그램들이 자체적으로 저장한 자격 증명에 HyperDesk는
접근하지 않습니다.

## 네트워크 통신

| 통신 | 대상 | 시점 |
|---|---|---|
| 연결 상태 확인(TCP 접속 시도, 0.8초 제한) | 대시보드에 있는 원격 호스트 | 대시보드 갱신 때마다 |
| 원격 접속 | 사용자가 연결한 호스트 | 사용자가 연결할 때 |

HyperDesk는 **인터넷에 접속하지 않습니다.** 위 두 가지는 사용자가 등록하거나 연결한 호스트로만
가고(보통 사내망), 업데이트 확인 같은 외부 통신은 없습니다. 업데이트는 Microsoft Store가 처리합니다.

## 레지스트리에 쓰는 값

Store가 아닌 설치본은 `rdp:` 링크를 열 수 있는 앱 목록에 HyperDesk를 올리기 위해 아래 키를
만듭니다. 기본 앱을 바꾸지는 않으며, 어떤 앱으로 열지는 Windows 선택 창에서 사용자가 고릅니다.

- `HKCU\Software\Classes\HyperDesk.rdp`
- `HKCU\Software\HyperDesk\Capabilities`
- `HKCU\Software\RegisteredApplications` 의 `HyperDesk` 값

Store 설치본은 이 키들 대신 앱 패키지 선언으로 등록되며, 앱 제거 시 함께 사라집니다.

## 다른 프로그램의 설정을 바꾸는 경우

Hyper-V 콘솔을 연결할 때, Windows 키와 Alt+Tab이 가상 컴퓨터로 전달되도록 Hyper-V 관리자의
키보드 설정을 "가상 컴퓨터에서 사용"으로 바꿉니다. Hyper-V 관리자 → Hyper-V 설정 → 키보드에서
직접 고르는 것과 같은 값이며, HyperDesk 밖에서 여는 콘솔에도 적용됩니다.

- 대상 파일: `%APPDATA%\Microsoft\Windows\Hyper-V\Client\1.0\clientsettings.config`
- 이 파일이 이미 있을 때만, 키보드 항목 하나만 바꿉니다. 파일이 없으면 만들지 않고 안내만 띄웁니다.
- 되돌리려면 Hyper-V 설정에서 다른 값을 고르면 됩니다(다음 콘솔 연결 때 다시 바뀝니다).

## 기업 도입 시 참고

HyperDesk는 원격 데스크톱 접속 기록을 레지스트리에서 **읽습니다**. 엔드포인트 소프트웨어에
사전 고지나 승인을 요구하는 조직이라면 이 문서를 정보보안 담당자와 먼저 공유해 주세요.

## 문의

GitHub 이슈: https://github.com/qetqet910/HyperDesk/issues
