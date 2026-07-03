<div align="center">
  <img src="src\assets\logo.png" width="80" height="80" alt="HyperDesk Logo" />
  <h1>HyperDesk</h1>
  <p><b>A VDI & VM Monitoring Tool based on Tauri and Rust</b></p>

  [![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
  [![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
  [![Rust](https://img.shields.io/badge/Rust-1.80%2B-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
  [![Windows Only](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white)](#)
  [![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-red.svg?style=flat-square)](LICENSE)
</div>

---

<img width="1374" height="778" alt="image" src="https://github.com/user-attachments/assets/55b4536e-b19a-480e-9d1c-b72467904955" />


## Overview

**HyperDesk**는 Hyper-V 가상 머신과 원격 데스크톱(RDP, Horizon) 세션을 단일 인터페이스에서 통합 모니터링하는 데스크톱 애플리케이션입니다. 

Win32 API와 Tauri v2를 활용하여 독립된 외부 프로세스 윈도우를 앱 내부 슬롯에 임베딩(Window Swallowing)하는 방식으로 구현되었습니다.

## Key Features

### Window Embedding
* **프로세스 종속성 관리**: RDP, VMware Horizon, VMConnect 등의 외부 프로세스 윈도우를 HyperDesk UI에 완벽하게 렌더링합니다.
* **Deadlock-Free 설계**: `AttachThreadInput`를 배제하고 독립적인 메시지 큐를 구성하여, 외부 프로세스에서 인증 모달 창이 발생해도 메인 UI의 프리징 현상이 발생하지 않습니다.
* **고속 동기화**: `requestAnimationFrame`과 백엔드 델타 필터링을 결합하여, 레이아웃 전환 및 리사이즈 시 외부 윈도우의 위치를 끊김 없이 추종합니다.

### Multi-Session Switching
* **동시 유지, 전환 뷰**: 최대 4개의 세션을 백그라운드에 동시에 살려두고, `Alt + 1~4` 단축키(또는 헤더 버튼)로 슬롯을 즉시 전환합니다. 전환해도 세션은 끊기지 않습니다.
* **VM 전체화면(몰입 모드)**: 활성 슬롯을 앱 UI 없이 화면 전체로 채워 세밀하게 관제할 수 있으며, 마우스를 화면 상단에 대면 컨트롤이 다시 나타납니다.
* **키보드 라우팅**: 활성 세션에 포커스가 있는 동안 Win 키/Alt+Tab 등 시스템 단축키를 VM 내부로 그대로 전달합니다.

### Telemetry & Auto-Recovery
* **실시간 리소스 트래킹**: 각 가상 머신의 CPU, 메모리 상태, IP 주소 및 업타임을 대시보드에서 파악할 수 있습니다.
* **비정상 종료 감지**: 타겟 윈도우 프로세스의 크래시를 감지하고, 지수 백오프(Exponential Backoff) 알고리즘을 통해 자동으로 재접속을 시도합니다.
* **스마트 사이징**: RDP `Smart Sizing`으로 슬롯 크기 변경 시에도 세션 재협상 없이 화면을 매끄럽게 맞춥니다.

## Tech Stack

* **Frontend**: React 19, TypeScript, Vite, Vanilla CSS
* **Backend**: Tauri v2, Rust
* **System API**: Win32 API (`SetParent`, `SetWindowPos`, `EnumWindows` 등)
* **CI/CD**: GitHub Actions (Stable Rust Toolchain, v2 Release)

## Getting Started

### Prerequisites

* [Rust](https://www.rust-lang.org/tools/install) (1.80+)
* [Node.js](https://nodejs.org/) (LTS 권장)
* [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (Windows 10/11 기본 탑재)
* **관리자 권한**: 외부 윈도우 프로세스를 제어하기 위해 앱 실행 시 관리자 권한이 요구됩니다.

### Installation & Development

```bash
# 의존성 패키지 설치
npm install

# 데브 모드 실행
npm run tauri dev
```

## License

Copyright © 2026 HyperDesk.

This software is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE) — free for noncommercial use; commercial use requires a separate license.
