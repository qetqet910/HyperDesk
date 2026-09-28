# Microsoft Store 등록 문구

Partner Center의 "Store 등록 정보" 입력란에 그대로 붙여 넣는 **평문**이다. Store는
마크다운을 렌더링하지 않으므로 코드 블록 안의 텍스트만 복사한다. 입력란별 글자 수 제한은
각 항목 제목에 적었다.

한국어 등록은 "한국어" 블록, 그 외 언어는 "English" 블록을 쓴다.

---

## 한국어

### 설명 (최대 10,000자)

```
원격 세션 4개를 띄워 두고, 키 하나로 오가세요.

HyperDesk는 Hyper-V 가상 머신 콘솔, 원격 데스크톱(RDP), Omnissa/VMware Horizon 데스크톱을 한 앱 안에서 다루는 Windows용 도구입니다.

Alt+1, Alt+2, Alt+3, Alt+4를 누르면 해당 세션이 즉시 화면을 채웁니다. 다시 연결하지도, 다시 불러오지도 않고, 떠나온 세션은 뒤에서 계속 돌아갑니다. 네 개를 작게 나눠 보는 대신, 한 번에 하나를 큰 화면으로 보고 키 하나로 넘깁니다.

진짜 클라이언트 창 그대로
세션은 화면을 캡처한 것이 아니라 Windows의 원격 데스크톱 연결, Hyper-V 가상 컴퓨터 연결, Horizon Client 창 그 자체입니다. 원래 클라이언트의 동작이 그대로 따라오고, Windows에 저장된 자격 증명과 클립보드 공유도 그대로 씁니다.

전체화면도 두 가지
F11로 앱을 전체화면으로, "VM 전체화면"으로 앱 화면까지 숨겨 세션이 모니터 전체를 쓰게 할 수 있습니다. 해제하면 들어가기 전 상태로 정확히 돌아옵니다.

Hyper-V 관리까지 한곳에서
VM 시작·중지·저장·일시정지, 메모리와 프로세서 조정, 새 VM 만들기, 스냅샷 생성·복원, VM별 CPU·메모리·디스크 사용량, 가상 스위치 구성, Hyper-V 이벤트 로그를 대시보드에서 확인합니다.

원격 자산 정리
PC에 남아 있는 원격 데스크톱 접속 기록과 Horizon 서버를 자동으로 찾아 목록으로 보여 주고, 직접 추가한 호스트와 합쳐 관리합니다. 호스트마다 메모와 태그를 붙이고, Ctrl+K 팔레트에서 이름이나 태그로 바로 찾아 연결합니다.

가볍고 조용하게
설치 파일이 10MB도 되지 않습니다. Windows에 내장된 WebView2로 화면을 그리고, 핵심 기능은 Rust로 Windows API에 직접 붙여 만들었습니다. 사용 통계를 수집하지 않고 개발자 서버로 아무것도 보내지 않으며, 비밀번호도 저장하지 않습니다. 인터넷 연결이 필요한 기능은 업데이트 확인 하나뿐이고 설정에서 끌 수 있습니다.

무료이며 소스가 공개된 오픈소스(MIT 라이선스)입니다.
```

### 이번 버전의 새로운 기능 (최대 1,500자)

```
- VM 화면 위에서 원격 마우스 커서가 깜빡이던 문제와 휠이 먹지 않던 문제를 고쳤습니다.
- Horizon 세션에서 Alt+1~4 전환이 가끔 안 되던 문제를 고쳤습니다.
- 키 입력이 한동안 멈추거나 키보드가 먹지 않던 문제를 고쳤습니다.
- F11 전체화면에서 VM 전체화면을 켰다 끄면 창 크기가 바뀌던 문제를 고쳤습니다.
- rdp:// 링크를 HyperDesk로 열 수 있습니다. 설정에서 해제할 수도 있습니다.
- 네트워크 화면(가상 스위치·트래픽)을 메뉴에 추가했습니다.
```

### 제품 기능 (항목당 최대 200자, 최대 20개)

```
Alt+1~4로 세션 4개를 끊김 없이 즉시 전환
Hyper-V 콘솔, 원격 데스크톱, Horizon 데스크톱을 진짜 창 그대로 앱 안에 표시
VM 전체화면 모드로 세션이 모니터 전체를 사용
VM 시작·중지·저장·일시정지, 메모리·프로세서 조정, 새 VM 만들기
스냅샷 생성·복원·삭제
VM별 CPU·메모리·디스크 사용량과 호스트 자원 그래프
가상 스위치와 네트워크 트래픽 확인
Hyper-V 이벤트 로그 확인
원격 데스크톱 접속 기록과 Horizon 서버 자동 탐지
호스트별 메모와 태그, Ctrl+K 팔레트 검색
사용 통계 수집 없음, 비밀번호 저장 없음
다크·라이트·레트로 테마, 한국어·영어 지원
```

### 검색어 (최대 7개)

```
Hyper-V
원격 데스크톱
RDP
VM 관리
가상 머신
Horizon
VDI
```

### 추가 시스템 요구 사항

```
VM을 관리하려면 Windows의 Hyper-V 기능이 켜져 있어야 하고, 사용 중인 계정이 로컬 "Hyper-V Administrators" 그룹에 속해 있어야 합니다. Horizon 세션을 쓰려면 Omnissa/VMware Horizon Client가 설치돼 있어야 합니다.
```

---

## English

### Description (up to 10,000 characters)

```
Keep four remote sessions open and jump between them with one keystroke.

HyperDesk is a Windows app for Hyper-V virtual machine consoles, Remote Desktop (RDP) sessions and Omnissa/VMware Horizon desktops, all in one place.

Press Alt+1, Alt+2, Alt+3 or Alt+4 and the matching session fills the view instantly. Nothing reconnects, nothing reloads, and the sessions you left keep running in the background. One full-size session at a time, switched in a keystroke, instead of four shrunken ones side by side.

The real client windows
Each session is the actual Remote Desktop Connection, Hyper-V Virtual Machine Connection or Horizon Client window, not a screenshot. The real client's behaviour comes along with it, including clipboard sharing and your saved Windows credentials.

Two kinds of full screen
Press F11 to make the app full screen, or use VM full screen to hide the app too so the session gets the whole monitor. Leaving either takes you back to exactly where you were.

Hyper-V management in the same app
Start, stop, save and pause VMs, change memory and processor count, create new VMs, take and restore snapshots, and watch per-VM CPU, memory and disk use, virtual switches and the Hyper-V event log from the dashboard.

Your remote hosts, organized
HyperDesk finds the Remote Desktop history and Horizon servers already on your PC and lists them next to the hosts you add yourself. Add memos and tags to any host, then find and connect from the Ctrl+K palette.

Light and private
The installer is under 10 MB. The interface runs on the WebView2 engine built into Windows, and the core is written in Rust directly against the Windows API. HyperDesk collects no usage data, sends nothing to the developer and stores no passwords. The only feature that uses the internet is the update check, which you can turn off in Settings.

Free and open source under the MIT license.
```

### What's new in this version (up to 1,500 characters)

```
- Fixed the remote mouse cursor flickering over VMs and the mouse wheel not working.
- Fixed Alt+1-4 sometimes not switching slots in Horizon sessions.
- Fixed key input occasionally stalling or the keyboard stopping working.
- Fixed the window size changing after leaving VM full screen that was entered from F11 full screen.
- HyperDesk can now open rdp:// links. You can turn this off in Settings.
- Added a Network page (virtual switches and traffic) to the menu.
```

### Product features (up to 200 characters each, up to 20)

```
Switch between four live sessions instantly with Alt+1-4
Hyper-V consoles, Remote Desktop and Horizon desktops as real windows inside the app
VM full screen gives a session the whole monitor
Start, stop, save and pause VMs; change memory and processors; create new VMs
Create, restore and delete snapshots
Per-VM CPU, memory and disk use plus host resource graphs
Virtual switches and network traffic
Hyper-V event log
Automatic discovery of Remote Desktop history and Horizon servers
Memos and tags on every host, searchable from the Ctrl+K palette
No usage tracking, no stored passwords
Dark, light and retro themes; English and Korean
```

### Search terms (up to 7)

```
Hyper-V
Remote Desktop
RDP
VM manager
virtual machine
Horizon
VDI
```

### Additional system requirements

```
To manage VMs, the Windows Hyper-V feature must be enabled and your account must be in the local "Hyper-V Administrators" group. Horizon sessions require the Omnissa/VMware Horizon Client.
```
