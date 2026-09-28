<div align="center">
  <img src="src/assets/logo.png" width="80" height="80" alt="HyperDesk Logo" />
  <h1>HyperDesk</h1>
  <p><b>Hyper-V 콘솔, 원격 데스크톱, Horizon 데스크톱을 앱 하나 안에서 진짜 창 그대로 띄웁니다.</b></p>

  [![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
  [![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
  [![Rust](https://img.shields.io/badge/Rust-1.80%2B-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
  [![Windows Only](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white)](#)
  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

  <br />

  [English](README.md) · **한국어**

  <br />

  <!-- 설치는 Microsoft Store 경유 — Microsoft가 서명·검증하고 자동 업데이트한다.
       GitHub 릴리즈의 .msixbundle은 Store 제출용 미서명 원본이라 직접 설치되지 않는다. -->
  [![Get it from Microsoft Store](https://img.shields.io/badge/Microsoft%20Store-설치하기-0078D6?style=for-the-badge&logo=microsoftstore&logoColor=white)](https://apps.microsoft.com/detail/9NPVXL622ZQQ)
</div>

---

<div align="center">
  <img src=".github/assets/hero.svg" width="1000" alt="HyperDesk SwallowGrid™ — 여러 세션을 Alt+1~4로 즉시 전환" />
</div>

<br />

<div align="center">
  <img width="930" alt="HyperDesk 대시보드" src="https://github.com/user-attachments/assets/55b4536e-b19a-480e-9d1c-b72467904955" />
</div>

## 무엇을 하나

원격 세션 4개를 띄워 두고, 키 하나로 오갑니다.

`Alt+1`, `Alt+2`, `Alt+3`, `Alt+4`를 누르면 해당 세션이 즉시 화면을 채웁니다. 다시 연결하지도,
다시 불러오지도 않고, 떠나온 세션은 뒤에서 계속 돌아갑니다. 네 개를 작게 나눠 보는 대신,
한 번에 하나를 큰 화면으로 보고 키 하나로 넘깁니다.

이게 가능한 건 세션이 진짜 클라이언트 창이기 때문입니다. 원격 데스크톱 연결(`mstsc.exe`),
Hyper-V 콘솔(`vmconnect.exe`), Omnissa/VMware Horizon 클라이언트 창을 Win32 `SetParent`로
HyperDesk 안에 넣습니다. 화면 캡처도, 프로토콜을 새로 구현한 것도 아니어서 원래 클라이언트의
동작이 그대로 따라옵니다. 클립보드 공유와 Windows에 저장된 자격 증명도 그대로 씁니다.

그 밖에 VM 시작·중지, 스냅샷, VM별 자원 사용량, Hyper-V 이벤트 로그 같은 일상 작업을
대시보드에서 하고, `Ctrl+K` 팔레트로 어디든 바로 갑니다.

## Electron이 아니라 React + Tauri

HyperDesk는 React 19 앱이지만, 브라우저를 통째로 싸 들고 다니지 않습니다.

- **가볍습니다.** v1.3.0 설치 파일은 약 7.5MB입니다. Chromium을 따로 넣지 않고, Tauri v2를
  통해 Windows에 이미 들어 있는 WebView2 엔진으로 화면을 그립니다.
- **무거운 일은 Rust로.** 창 임베드, 키보드 훅, Hyper-V PowerShell 연동, 레지스트리 탐색을
  Rust로 Win32 API에 직접 붙여 짰습니다. 중간에 네이티브 애드온 계층이 없습니다.
- **화면은 React로.** React 19 + TypeScript, 실시간 데이터는 TanStack Query, 세션 전환
  애니메이션은 Framer Motion, 그래프는 Recharts입니다.
- **잠가 두었습니다.** 웹 계층은 엄격한 콘텐츠 보안 정책(CSP)과 Tauri 권한 체계 아래에서
  돌고, Rust 쪽과는 타입이 붙은 명령 모듈 하나(`src/lib/tauri-api.ts`)로만 대화합니다.

재미있는 부분은 Tauri/WebView2 창이 다른 프로그램의 네이티브 창을 품고, React 레이아웃에 맞춰
함께 움직인다는 점입니다. 어떻게 동작하는지, 어떤 Win32 함정을 만났는지는
[CLAUDE.md](CLAUDE.md)에 정리돼 있습니다.

## 기능

### 세션 전환 (SwallowGrid™)

- **슬롯 안의 진짜 창.** RDP·Hyper-V 콘솔·Horizon 세션을 앱 안에 넣고, 창 이동·크기 변경·
  레이아웃 전환에도 슬롯을 따라가게 합니다.
- **4개 동시 유지, 1개 표시.** 세션 4개가 동시에 돌고, `Alt+1`~`4`나 오른쪽 세션 목록으로
  전환합니다. 숨은 슬롯의 세션도 계속 살아 있습니다.
- **VM 이름으로 찾는 Hyper-V 콘솔.** VMConnect 창을 제목의 VM 이름으로 찾아서, VMConnect가
  이미 떠 있는 인스턴스로 넘겨 버리는 경우에도 맞는 콘솔이 맞는 슬롯에 들어갑니다. 리본과
  테두리는 잘라내서 게스트 화면만 보입니다.
- **Horizon 데스크톱.** Horizon의 화면 영역을 슬롯에 고정하고 연결 바는 숨깁니다.
- **떠 있는 헤더.** 세션 위에 얇은 헤더가 떠 있고 좌우로 옮길 수 있습니다. 연결 이름,
  전체화면 버튼, 연결 해제 버튼이 있고, VM 전체화면에서는 1~4 슬롯 전환 버튼도 나옵니다.
- **두 가지 전체화면.** `F11`은 앱 창을 전체화면으로, VM 전체화면 버튼은 앱 UI까지 숨겨
  세션이 화면 전체를 쓰게 합니다. 어느 쪽이든 해제하면 들어가기 직전 상태로 돌아갑니다.
  `Esc`로 나옵니다.
- **멈추지 않는 구조.** `AttachThreadInput`을 쓰지 않아서, 임베드된 클라이언트가 인증서·
  로그인 창을 띄워도 HyperDesk가 멈추지 않습니다.

### VM · 원격 자산 관리

- **VM 제어.** 시작·중지·저장·재개·일시정지, 메모리·프로세서 수 변경, 새 VM 만들기.
- **스냅샷.** 대시보드에서 만들고, 되돌리고, 지웁니다.
- **원격 자산.** 레지스트리에서 찾은 RDP 접속 기록·Horizon 서버와 직접 추가한 호스트를
  합쳐 보여 줍니다. 자동으로 찾은 항목도 이름 변경·숨김·삭제가 됩니다.
- **메모와 태그.** VM과 호스트마다 메모와 태그를 붙이고, 커맨드 팔레트에서 `@태그`로
  걸러 봅니다.
- **빠른 연결.** `Ctrl+K`에서 주소를 입력하고 Enter.
- **`rdp:` 링크.** `rdp://` 링크를 여는 앱으로 HyperDesk를 고를 수 있습니다. 링크의 호스트를
  원격 자산에 추가하고 슬롯에서 엽니다. 링크에서는 주소와 사용자 이름만 받고, 그 밖의
  `.rdp` 설정은 무시합니다. 설정에서 목록에서 다시 뺄 수 있습니다.

### 모니터링

- **자원 사용량.** VM별 CPU·메모리·디스크 여유·IP·가동 시간, 그리고 세션 옆에 호스트 PC의
  CPU·메모리·디스크 그래프.
- **호스트 상태.** 원격 호스트마다 짧은 TCP 확인을 해서, 접속하기 전에 꺼진 호스트가 보입니다.
- **네트워크.** Hyper-V 가상 스위치, VM별로 연결된 스위치, 호스트 네트워크 트래픽.
- **이벤트 로그.** 최근 Hyper-V 이벤트(VMMS·Worker 로그)와 HyperDesk 자체 활동 기록.
- **세션 종료 감지.** 임베드된 클라이언트가 종료되거나 죽으면 슬롯이 알아채고, 죽은 창 대신
  "다시 연결" 버튼을 보여 줍니다. 저절로 다시 붙지는 않아서, VM 안에서 로그오프한 세션은
  닫힌 채로 남습니다.

### 일상 사용

- **커맨드 팔레트.** `Ctrl+K`로 검색, 이동, VM·호스트 작업.
- **테마 3종.** 다크, 라이트, Windows 9x 레트로.
- **영어 · 한국어.** OS 언어로 정해지고 설정에서 바꿀 수 있습니다.
- **깔끔한 종료.** HyperDesk를 닫으면 임베드된 창을 모두 풀어 주고 그 세션을 끝내서, 닫힌 앱
  안에 클라이언트가 갇혀 남지 않습니다.
- **접이식 사이드바.** `Ctrl+B`.

## 단축키

| 키 | 동작 |
|---|---|
| `Alt+1` ~ `Alt+4` | 슬롯 전환 (세션에 포커스가 있어도 동작) |
| `F11` | 앱 전체화면 켜기/끄기 (멀티 뷰) |
| `Esc` | 전체화면 / VM 전체화면 해제 |
| `Ctrl+K` | 커맨드 팔레트 |
| `Ctrl+B` | 사이드바 접기/펴기 |

## 설치

**Microsoft Store**에서 설치하세요. Microsoft가 패키지를 서명·검증하고 자동으로 업데이트합니다.

> **[▶ Microsoft Store에서 설치](https://apps.microsoft.com/detail/9NPVXL622ZQQ)**

> ⚠️ GitHub 릴리즈에 첨부되는 `.msixbundle`은 **Store 제출용 미서명 원본**이라 직접 설치되지
> 않습니다. 위 Store 링크를 이용해 주세요.

**요구 사항**

- Windows 10 또는 11, [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
  (Windows 11에는 기본 포함).
- VM을 관리하려면 Hyper-V 기능이 켜져 있어야 하고, 사용자 계정이 로컬
  **Hyper-V Administrators** 그룹에 속해야 합니다(`Get-VM`, `Start-VM` 등). HyperDesk 자체는
  관리자 권한 없이 실행되며, 창 임베드에도 관리자 권한이 필요 없습니다.
- Horizon 슬롯을 쓰려면 Omnissa/VMware Horizon Client가 설치돼 있어야 합니다.

## 알려진 제한

- **세션 안에서의 Windows 키.** 세션에 포커스가 있을 때 Windows 키를 누르면 *로컬* 시작 메뉴도
  함께 열립니다. 창이 임베드된 상태에서 원격 클라이언트가 스스로 그렇게 동작해서, HyperDesk가
  바깥에서 막을 수 없습니다. `Alt+Tab`과 `Alt+1`~`4`는 정상 동작합니다.
- **RDP 해상도.** 기본 원격 데스크톱 클라이언트는 연결 중에 해상도를 바꾸지 못합니다. 슬롯
  크기가 바뀌면 화면을 다시 그리지 않고 늘이거나 줄여 맞추므로(스마트 크기 조정), 크게 바뀐
  뒤엔 흐릿할 수 있습니다. 선명하게 보려면 다시 연결하세요.
- **Windows 전용.** Win32 API 기반이라 macOS·Linux 버전은 없습니다.

## 개인정보

HyperDesk에는 사용 통계, 분석, 계정이 없고 개발자에게 아무것도 보내지 않습니다. 비밀번호도
저장하지 않으며, 로그인은 원격 데스크톱·Horizon 클라이언트가 처리합니다. 인터넷에 나가는 요청은
설정의 업데이트 확인뿐이고, 폐쇄망에서는 끌 수 있습니다. 무엇을 읽고, 저장하고, 어디와
통신하는지는 [PRIVACY.md](PRIVACY.md)에 정리돼 있습니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| VM이 안 보이거나 시작·중지가 권한 오류로 실패 | 계정을 로컬 **Hyper-V Administrators** 그룹에 추가하고 로그아웃 후 다시 로그인하세요. |
| `Alt+1`~`4`가 이유 없이 안 먹음 | 작업 관리자에 예전에 실행한 `hyperdesk.exe`가 남아 있는지 확인하세요. 남은 인스턴스가 단축키를 쥐고 있으니 종료하고 HyperDesk를 다시 실행하세요. |
| `rdp://` 링크를 열면 "localhost에 연결할 수 없음" 화면이 뜸 | 링크가 개발용 빌드에 연결돼 있는 상태입니다. 그 빌드의 설정에서 `rdp://` 링크 등록을 해제한 뒤, 링크를 다시 열어 설치된 HyperDesk를 고르세요. |
| 슬롯이 검은 화면으로 남음 | 슬롯의 X 버튼으로 연결을 끊고 다시 연결하세요. 계속 반복되면 [이슈](https://github.com/qetqet910/HyperDesk/issues)로 알려 주세요. |

## 개발

### 준비물

- [Rust](https://www.rust-lang.org/tools/install) 1.80+
- [Node.js](https://nodejs.org/) LTS
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

### 실행

```bash
npm install
npm run tauri dev     # Rust 백엔드 + React (핫 리로드)
```

### 그 밖의 명령

```bash
npm run build         # TypeScript 검사 + Vite 번들
npx vitest run        # 프론트엔드 테스트
npm run tauri build   # 배포용 빌드 (NSIS 설치 파일)

cd src-tauri
cargo test            # Rust 유닛 테스트
cargo clippy          # Rust 린트
```

debug 빌드는 `%TEMP%\hyperdesk-swallow.log`에 진단 로그를 남깁니다. 임베드된 창이 이상하게
굴 때 가장 먼저 볼 곳입니다.

구조 설명, Win32 제약, 문제 해결 이력은 [CLAUDE.md](CLAUDE.md)에 있습니다.

### 릴리즈

`v*` 태그를 push하면 GitHub Actions(`.github/workflows/release.yml`)가 빌드하고 릴리즈를
게시합니다. 버전은 `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
`src-tauri/hyperdesk.exe.manifest` 네 곳을 똑같이 맞춰야 합니다.

## 기술 스택

- **프론트엔드:** React 19, TypeScript, Vite, 일반 CSS, Framer Motion, Recharts, dotLottie
- **백엔드:** Tauri v2, Rust
- **시스템:** Win32(`SetParent`, `SetWindowPos`, `SetWindowRgn`, 저수준 키보드 훅), Hyper-V용
  PowerShell, RDP·Horizon 호스트 탐지용 Windows 레지스트리

## 라이선스

[MIT](LICENSE). 사용한 오픈소스 구성요소와 라이선스는
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)에 있습니다.

HyperDesk는 Microsoft, Broadcom(VMware), Omnissa와 제휴 관계가 없습니다. 각 제품명은 해당
소유자의 상표입니다.
