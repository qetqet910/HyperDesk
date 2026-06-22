# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

HyperDesk is a Windows-only enterprise desktop app that unifies Hyper-V VM management and remote desktop sessions (RDP, VMware Horizon) into a 2×2 grid interface. Its core innovation is **SwallowGrid™** — a Win32 technique that embeds external application windows (mstsc.exe, vmconnect.exe, Horizon client) directly into React grid slots using `SetParent`/`SetWindowPos`.

Tech stack: React 19 + TypeScript + Vite (frontend), Tauri v2 + Rust (backend), Win32 API (window swallowing), PowerShell (Hyper-V automation).

## Commands

```bash
# Development
npm install                 # Install dependencies
npm run tauri dev           # Full dev mode (Rust + React with HMR)
npm run dev                 # Frontend-only (port 1420, no Rust backend)

# Build & Release
npm run build               # TypeScript check + Vite bundle
npm run tauri build         # Production build → NSIS installer (dist/)

# Rust only (from src-tauri/)
cargo build                 # Compile Rust backend
cargo test                  # Run Rust unit tests (hosts.rs has persistence tests)
cargo clippy                # Rust linting
```

Release builds are triggered by pushing a `v*` tag — GitHub Actions builds the MSI on Windows runners via `.github/workflows/release.yml`.

## Architecture

### Frontend → Backend Communication

All IPC goes through `src/lib/tauri-api.ts`, which wraps `invoke<T>()` from `@tauri-apps/api/core`. The file also exports mock fallbacks so the frontend can be tested in a browser without Tauri. When adding new commands, add both the Rust handler in `src-tauri/src/commands.rs` and a typed wrapper in `tauri-api.ts`.

Backend → Frontend async events use `app.emit()` in Rust and `listen<T>()` in the frontend (from `@tauri-apps/api/event`). Key events: `hotkey-focus`, `swallow-success`, `swallow-failure`, `swallow-progress`, `window-closed`.

### Window Swallowing (`src-tauri/src/swallow.rs`)

The core Win32 engine. Flow:
1. Find the target process window by PID using `EnumWindows`
2. Call `SetParent(hwnd, webview_container_hwnd)` to reparent the window into the WebView container (Chrome_WidgetWin)
3. `SetWindowPos` to position/resize within the slot bounds
4. A background stabilization thread runs 200 iterations × 200ms = 40s to enforce styles/position

**Z-order reality**: After `SetParent`, the swallowed Win32 window sits **above** the WebView2 renderer within Chrome_WidgetWin. This means HTML elements in slot areas are hidden behind the swallowed window. To keep controls accessible, the slot uses a **permanent 36px `slot-header-bar`** at the top — positioned above where the Win32 child starts — so header buttons are always reachable.

**SlotLayout pattern** (`SwallowSlot.tsx`):
- Outer `.swallow-slot`: flex column container (no ref)
- `.slot-header-bar`: 36px, always rendered when `isSwallowed`, never covered by Win32 child
- `.slot-content-area` (ref=`contentRef`): flex:1, this is what `getBoundingClientRect()` measures and what the Win32 window fills

**VMConnect ribbon**: VMConnect has a non-removable 30px client-area ribbon. Fix: position window at `y - 30`, height `+ 30`, then call `SetWindowRgn(CreateRectRgn(0, 30, w, h+30))` to mask the ribbon from view. The stabilization loop reapplies the region if VMConnect resets it.

**RDP settings** (in `commands.rs` `connect_vm`): uses `screen mode id:i:2` (windowed — avoids fullscreen connection bar), `dynamic resolution:i:1` (live resize via `WM_SIZE` already sent by sync loop), `pinned connection bar:i:0`, slot dimensions instead of hardcoded 1280×720. `authentication level:i:2` (warn-but-allow) — **never set this to `i:0`**; it silently bypasses server identity verification and exposes RDP sessions to MITM.

**Focus forwarding**: `swallow::focus_window(slot_id)` calls `SetForegroundWindow` + `BringWindowToTop`. Called directly from Alt+1–4 hotkey handlers in `lib.rs` and via `focus_slot_window` Tauri command (triggered by `MultiView.tsx` on hotkey events).

**Critical**: Does NOT use `AttachThreadInput` (deadlock risk). The Tauri main window requires admin privileges (declared in `hyperdesk.exe.manifest`) for `SetParent` to work across process boundaries.

### Dashboard & Host Data (`src-tauri/src/commands.rs`, `hosts.rs`)

`get_dashboard()` is the main data-fetching command. It:
1. Loads manually added hosts from `%APPDATA%/HyperDesk/hosts.json`
2. Scans Windows registry for RDP history (`HKCU\Software\Microsoft\Terminal Server Client\Servers`) and Horizon servers (`HKCU\Software\[VMware|Omnissa]\...`)
3. Merges both sources, deduplicates by hostname
4. Runs parallel TCP health checks (800ms timeout) to get latency/status
5. Filters hidden hosts

**Smart persistence**: Auto-detected hosts (from registry) are NOT written to `hosts.json` unless the user modifies them (hide/rename). Only user overrides are persisted. This prevents stale data accumulation.

### Frontend State

- `src/hooks/useDashboard.ts` — TanStack React Query hooks polling `get_dashboard()` and `get_system_stats()` at configurable intervals (default: 5s dashboard, 2s telemetry)
- `src/components/MultiView.tsx` — 2×2 grid controller managing slot assignments, focus mode (expand one slot), and theater mode (hide all UI chrome)
- `src/components/SwallowSlot.tsx` — Individual grid cell; measures its DOM position and calls `swallow_window` / `sync_slot_bounds`

### Telemetry

`get_system_stats()` returns CPU%, memory%, uptime, disk free, and network I/O deltas. The backend maintains a rolling 30-sample history. Frontend renders sparklines via Recharts.

## Key Files

| File | Role |
|------|------|
| `src/lib/tauri-api.ts` | Single source of truth for all Tauri commands — typed wrappers + browser mocks |
| `src/types.ts` | Shared TypeScript interfaces (`VmInfo`, `RemoteHost`, `SystemStats`, `SlotState`) |
| `src-tauri/src/commands.rs` | All `#[tauri::command]` handlers (~765 lines) |
| `src-tauri/src/swallow.rs` | Win32 window embedding engine (~486 lines) |
| `src-tauri/src/hosts.rs` | Host file I/O + smart merge/filter logic |
| `src-tauri/src/models.rs` | Rust structs mirroring `src/types.ts` |
| `src-tauri/src/lib.rs` | Tauri app setup: command registration, tray menu, global hotkeys (Alt+1–4) |

## Platform Constraints

- **Windows only**: Uses Win32 APIs (`SetParent`, `EnumWindows`, `SetWindowPos`), PowerShell (`Get-VM`), and `winreg` for registry access. There is no cross-platform abstraction.
- **Admin required**: The app requests elevation via `hyperdesk.exe.manifest` — window swallowing across process boundaries requires it.
- **WebView2 runtime**: Must be installed on the target machine (bundled in the NSIS installer).
- **DPI awareness**: Set at process level in `main.rs` via `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)` before Tauri initializes.

## Security & Commercialization Guidelines (재발 방지 — 절대 어기지 말 것)

상용화 보안 점검(2026-06)에서 발견되어 수정된 항목들이다. 같은 취약점을 다시
만들지 않도록 아래 규칙을 항상 지킨다.

1. **PowerShell 스크립트 작성 규칙**: `commands.rs`에서 사용자/VM 이름 등
   문자열을 PowerShell 스크립트에 보간(`format!`)할 때는 **반드시**
   `ps_escape()` 헬퍼를 거쳐야 한다 (`name.replace('\'', "''")`를 직접 쓰지
   말 것 — 헬퍼가 한 곳에서 일관되게 관리한다). 새 `#[tauri::command]`를
   추가할 때 문자열 파라미터가 하나라도 스크립트에 들어간다면 이 규칙을
   적용한다. 숫자형(`u32` 등) 파라미터는 타입 자체가 보호해주므로 예외.
2. **RDP `authentication level`은 절대 `i:0`으로 두지 않는다.** `i:0`은 서버
   인증서 검증 실패를 사용자에게 알리지 않고 그대로 접속해 MITM에 노출시킨다.
   `i:2`(경고 후 사용자 선택)를 유지한다.
3. **CSP를 `null`로 되돌리지 않는다** (`tauri.conf.json` `app.security.csp`).
   웹뷰가 백엔드 커맨드(admin 권한)에 직접 접근할 수 있는 Tauri 구조상, CSP
   해제는 XSS를 OS 권한 탈취로 직결시킨다. 새 스크립트/스타일 소스가
   필요하면 `unsafe-inline` 전체 허용 대신 필요한 directive만 넓힌다.
4. **`SWALLOW_STATE.lock().unwrap()`을 직접 쓰지 않는다.** `swallow.rs`의
   `lock_state()` 헬퍼(poison 복구 처리)를 통해서만 접근한다. 어느 스레드든
   락을 쥔 채 패닉하면 poison된 Mutex가 이후 모든 swallow/unswallow/focus
   호출을 연쇄적으로 실패시키기 때문이다.
5. **버전 동기화**: `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, `src-tauri/hyperdesk.exe.manifest`의 버전 문자열은
   항상 동일하게 맞춘다. 릴리즈 전 `grep -rn "version" package.json
   src-tauri/tauri.conf.json src-tauri/Cargo.toml`으로 확인.
6. **`-rc`/`-beta`/`-alpha` 의존성을 프로덕션에 고정하지 않는다.** 안정
   버전이 나왔으면 즉시 `Cargo.toml`/`package.json`에서 안정 버전 범위로
   교체한다 (예: `tauri-plugin-global-shortcut`은 `"2"`로 고정, RC 핀 금지).
7. **개발용 산출물(스크래치 코드, 내부 도구 state/DB 파일, 디버그 메모)는
   git에 커밋하지 않는다.** `.gitignore`의 `scratch/`, `Untitled-*.txt`,
   `.gsd.migrating/` 규칙을 유지하고, 새로운 임시 디렉터리를 만들면 같은
   방식으로 무시 목록에 추가한다.
8. **Tauri updater 서명키(`src-tauri/*.key`)는 절대 커밋하지 않는다.**
   개인키/비밀번호는 GitHub Actions secrets(`TAURI_SIGNING_PRIVATE_KEY`,
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`)로만 보관한다. `tauri.conf.json`의
   `plugins.updater.pubkey`는 공개키이므로 커밋해도 안전하다.
9. **법적 문서**: `LICENSE`(EULA), `THIRD-PARTY-NOTICES.md`,
   `PRIVACY.md`는 초안이며 실제 유료 출시 전 법률 검토가 필요하다는 점을
   사용자에게 다시 알릴 것 — 이 프로젝트의 코드만으로 완전한 법적 효력을
   보장할 수 없다.

## Troubleshooting Memory (기억해야 할 에러들)

- **Issue:** VmConnect 창을 Swallow 할 때 위쪽에 30px 검은 여백이 생기는 현상.
- **Fix:** `swallow.rs`에서 창 클래스명이 `TscShellContainerClass`인 경우, Y-offset을 -30으로 강제 보정하도록 하드코딩함. 이 로직을 지우지 말 것.
- **Issue:** React 상태 업데이트 시 창이 깜빡이는 현상.
- **Fix:** `SwallowSlot.tsx`에서 리렌더링이 발생해도 `sync_slot_bounds` 호출을 디바운스(Debounce) 처리함. (현재 16ms)
- **Issue:** 상단 타이틀바(`Topbar.tsx`, `data-tauri-drag-region`)를 잡고 드래그해도 창이 움직이지 않음.
- **Fix:** Tauri v2에서 `data-tauri-drag-region`은 내부적으로 `plugin:window|start_dragging`을 invoke하므로 `src-tauri/capabilities/default.json`에 `core:window:allow-start-dragging` 권한이 **반드시** 있어야 한다. 새 `core:window:allow-*` 권한을 추가/정리할 때 이 권한을 빠뜨리지 말 것 — 빠져도 콘솔에 에러가 안 뜨고 그냥 조용히 드래그만 안 먹는다.
- **Issue:** 멀티뷰 극장모드(`MultiView.tsx`)에서 마우스를 상단에 올리면 헤더가 보이긴 하는데 버튼 클릭이 안 됨.
- **Fix:** `.theater-hit-zone`(호버 감지용 투명 레이어, z-index:600)이 항상 같은 자리(top:0, height:52px)에 떠 있어서, `.multiview-header`의 z-index가 이보다 낮으면(과거 극장모드에서 550으로 낮춰져 있었음) 호버로 헤더가 보여도 클릭은 hit-zone이 가로챈다. 극장모드 헤더 z-index는 항상 hit-zone(600)보다 높게(현재 650) 유지할 것 — 이 둘의 z-index 관계를 건드리는 수정을 할 땐 반드시 같이 확인.
- **Issue:** 멀티뷰에서 VM/RDP가 swallow된 상태로 상단에 마우스를 올려 호버 헤더(`.multiview-header`)를 내리면, 헤더 아래쪽 일부가 VM 화면에 가려져 겹쳐 보이고 그 부분 버튼이 안 눌림.
- **Fix:** swallow된 Win32 자식 창은 WebView2 표면 **물리적으로 위**에 있어서 DOM `z-index`로는 절대 못 덮는다. HTML이 VM 위에 보이는 유일한 구간은 각 슬롯 상단 **36px `.slot-header-bar`**(Win32는 그 아래 `.slot-content-area`만 채움). 그래서 `.multiview-header` 높이를 **36px로 고정**(과거 52px라 아래 16px가 VM에 먹혔음)하고, 그 안의 `.control-group`(버튼 28px+패딩 2px=32px)도 36px 안에 들어오게 맞춤. 이 헤더 높이를 36px보다 키우거나 컨트롤을 키우면 바로 재발한다 — `App.css`의 `.multiview-header`/`.control-group` 주석을 지우지 말 것.
