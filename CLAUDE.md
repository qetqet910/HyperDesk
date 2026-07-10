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
4. A background stabilization thread polls with adaptive backoff (100ms → 1s once stable, any correction resets to fast) for the **life of the swallow** to enforce styles/position — it doubles as the slot watchdog: its `IsWindow` check detects a crashed/closed child and emits `window-closed` (do not re-add a deadline; a child dying after it left the slot showing a corpse)

**Z-order reality**: After `SetParent`, the swallowed Win32 window sits **above** the WebView2 renderer within Chrome_WidgetWin. This means HTML elements in slot areas are hidden behind the swallowed window. To keep controls accessible, the slot uses a **permanent 36px `slot-header-bar`** at the top — positioned above where the Win32 child starts — so header buttons are always reachable.

**SlotLayout pattern** (`SwallowSlot.tsx`):
- Outer `.swallow-slot`: flex column container (no ref)
- `.slot-header-bar`: 36px, always rendered when `isSwallowed`, never covered by Win32 child
- `.slot-content-area` (ref=`contentRef`): flex:1, this is what `getBoundingClientRect()` measures and what the Win32 window fills

**VMConnect ribbon**: VMConnect has a non-removable 30px client-area ribbon. Fix: position window at `y - 30`, height `+ 30`, then call `SetWindowRgn(CreateRectRgn(0, 30, w, h+30))` to mask the ribbon from view. The stabilization loop reapplies the region if VMConnect resets it.

**RDP settings** (in `commands.rs` `connect_vm`): uses `screen mode id:i:1` (windowed — the connection bar is a fullscreen-only element, so it never exists), `smart sizing:i:1` (classic mstsc can't renegotiate resolution mid-session; the bitmap is scaled to the slot instead — connect happens at full primary-monitor resolution to minimize blur), `keyboardhook:i:1` (Win key/Alt+Tab go to the remote whenever the session has focus; Alt+1~4 slot switching survives because the LL keyboard hook intercepts those before the remote sees them). `authentication level:i:2` (warn-but-allow) — **never set this to `i:0`**; it silently bypasses server identity verification and exposes RDP sessions to MITM.

**Focus forwarding**: `swallow::focus_window(slot_id)` calls `SetForegroundWindow` + `BringWindowToTop`. Called directly from Alt+1–4 hotkey handlers in `lib.rs` and via `focus_slot_window` Tauri command (triggered by `MultiView.tsx` on hotkey events).

**Keyboard routing**: a `WH_KEYBOARD_LL` hook (`swallow::install_keyboard_hook`, installed in `lib.rs` setup) is active only while HyperDesk is foreground AND keyboard focus lives inside a swallowed child's window tree (`vm_key_target` checks every thread in the tree — mstsc keeps its input window on a different thread than its frame). It (a) eats Win-key/Alt+Tab locally and posts them to the focused child — a reparented mstsc forwards those keys to the remote but fails its own foreground check, so without the hook the HOST shell reacted too; (b) intercepts Alt+1~4 and re-emits `hotkey-focus` so slot switching keeps working even when the remote would otherwise swallow it (`keyboardhook:i:1`).

**Immersive mode**: `set_immersive` arms a Rust cursor poller (`swallow::set_immersive`). In immersive the header floats `position:absolute` UNDER the VM surface so the VM keeps 100% of the screen at native resolution; top-edge hover makes the poller crop the VM's top 36-CSS-px band via `SetWindowRgn` (`apply_reveal`), letting the header show through and take clicks — the VM never moves or resizes on reveal (moving it caused visible up/down judder).

**Chrome region is single-sourced (`apply_chrome_region` + `REVEAL_BAND`)**: every `SetWindowRgn` call in `swallow.rs` (initial swallow, the vmconnect stabilization loop's per-poll chrome re-measurement, and the immersive reveal poller) goes through one helper that composes the window's own chrome crop (`offset`/`offset_x`) with the current reveal band. Do NOT add a standalone `CreateRectRgn`/`SetWindowRgn` call anywhere else — vmconnect's stabilization loop re-applies its region on every re-measured tick for the life of the swallow, and a second uncoordinated writer WILL periodically stomp the reveal crop back to "hidden" (this is exactly why immersive reveal worked for RDP but not Hyper-V before the fix — RDP's offset is always 0 and nothing else ever touched its region after the initial swallow).

**Disconnect (X / `unswallow_window`) actually ends the session**: `swallow::unswallow` restores the window to a normal top-level frame (in case the app shows its own "disconnect?" prompt and the user cancels — it lands as an ordinary floating window, not stuck invisible inside HyperDesk) and then posts `WM_CLOSE`. It does NOT leave the process running detached-and-minimized (that was the old behavior — deliberately removed since "detach" reads to a user as "still connected, window just hidden," which it wasn't).

**Critical**: Does NOT use `AttachThreadInput` (deadlock risk — the LL keyboard hook above is message-based and fine). `hyperdesk.exe.manifest` requests `asInvoker`, not `requireAdministrator` (changed 2026-07 for MS Store: an MSIX/Desktop Bridge full-trust app that demands elevation crashes on launch — AppX activation can't show the normal UAC consent flow). `SetParent` across process boundaries does NOT need admin — verified directly (P/Invoke SetParent+WS_CHILD+SetWindowPos between two ordinary Medium-IL processes reparents and repositions correctly); UIPI only blocks a LOWER integrity level window messaging a HIGHER one, and both HyperDesk and mstsc/vmconnect run at the user's own IL. The Hyper-V PowerShell cmdlets (`Get-VM`/`Start-VM`/etc., see `run_powershell`) are the thing that actually needs elevated rights for a non-admin user — put the user in the local **Hyper-V Administrators** group instead of re-adding `requireAdministrator`.

### Dashboard & Host Data (`src-tauri/src/commands.rs`, `hosts.rs`)

`get_dashboard()` is the main data-fetching command. It:
1. Loads manually added hosts from `%APPDATA%/HyperDesk/hosts.json`
2. Scans Windows registry for RDP history (`HKCU\Software\Microsoft\Terminal Server Client\Servers`) and Horizon servers (`HKCU\Software\[VMware|Omnissa]\...`)
3. Merges both sources, deduplicates by hostname
4. Runs parallel TCP health checks (800ms timeout) to get latency/status
5. Filters hidden hosts

**Smart persistence**: Auto-detected hosts (from registry) are NOT written to `hosts.json` unless the user modifies them (hide/rename). Only user overrides are persisted. This prevents stale data accumulation.

**Warm PowerShell worker** (`run_powershell_warm` in `commands.rs`): a cold `powershell.exe` costs ~1.3s (spawn + Hyper-V module load + CIM session — measured 2026-07-09; the query itself is ~30ms warm), so the hot 5s polling paths (`get_vms`, RDP scan) go through one resident PowerShell process fed base64 scripts over stdin. **Only route read-only, fast scripts through it** — lifecycle commands (Start/Stop-VM, checkpoints) stay on cold `run_powershell` because Stop-VM can block 30s and would hold the worker mutex in front of dashboard polls. Any worker failure falls back to a cold spawn automatically.

### Frontend State

- `src/hooks/useDashboard.ts` — TanStack React Query hooks polling `get_dashboard()` and `get_system_stats()` at configurable intervals (default: 5s dashboard, 2s telemetry)
- `src/components/MultiView.tsx` — single-view controller: 4 slots stay mounted (sessions persist) but only one is visible; Alt+1–4 / header buttons page between them. Its slot-switcher controls render inside each slot's 36px header bar via the `headerControls` prop (never as a separate floating header)
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
- **Not admin-elevated**: `hyperdesk.exe.manifest` requests `asInvoker` (MS Store MSIX requires this — `requireAdministrator` crashes on launch under AppX activation). Window swallowing does not need admin (see the swallow.rs note above). Users who aren't in the local Hyper-V Administrators group will still hit permission errors from the `Get-VM`/`Start-VM`/etc. PowerShell calls specifically — that's a separate requirement, not a manifest one.
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

- **Issue:** 로딩 화면 Lottie 애니메이션이 `npm run tauri dev`에선 보이는데 **프로덕션 빌드에선 텍스트만 뜨고 안 나옴**(2026-07-06 확정).
- **Fix:** `@lottiefiles/dotlottie-web`은 WASM 바이너리를 기본적으로 `cdn.jsdelivr.net`에서 fetch하는데, 프로덕션 CSP(`connect-src 'self'`)가 외부 CDN을 막아 플레이어 초기화가 조용히 실패한다(dev는 Vite가 CSP 없이 서빙해서 통과). 두 가지를 함께 유지할 것: (1) `App.tsx`에서 `@lottiefiles/dotlottie-web/dotlottie-player.wasm?url`을 import해 dist에 번들하고 `setWasmUrl()`로 same-origin 경로를 지정(수동 `public/` 복사 금지 — 패키지 업데이트 시 버전 불일치로 조용히 깨진다). (2) `tauri.conf.json` CSP의 `script-src`에 **`'wasm-unsafe-eval'`**을 유지(WASM 컴파일에 필요). 보안 점검 때 이 토큰을 지우거나 `setWasmUrl` 호출을 빼면 로딩 애니메이션이 다시 사라진다. `'wasm-unsafe-eval'`은 `'unsafe-eval'`과 달리 임의 JS eval을 허용하지 않는 최소 완화라 규칙 #3에 위배되지 않는다.
- **Issue:** VmConnect 창을 Swallow 할 때 위쪽에 30px 검은 여백이 생기는 현상.
- **Fix:** `swallow.rs`에서 창 클래스명이 `TscShellContainerClass`인 경우, Y-offset을 -30으로 강제 보정하도록 하드코딩함. 이 로직을 지우지 말 것.
- **Issue:** Hyper-V swallow 후 몇 초 뒤 VM 화면 하단에 여백이 남거나(2026-07-02) VM 사방에 흰 테두리가 남는 현상(2026-07-03 로그로 확정).
- **Fix:** vmconnect는 접속 후 Basic→Enhanced Session으로 **자식 트리를 통째로 교체**한다. Enhanced는 RDP 트리(`UIMainClass`/`OPWindowClass`)라 `HwndWrapper[vmconnect]` 비디오 자식이 없고 콘텐츠가 **클라이언트 영역을 꽉 채운다**. 그래서 흰 테두리의 정체는 자식 인셋이 아니라 **프레임 자체의 non-client 경계**(WinForms가 WS_THICKFRAME를 벗겨도 2~3px 테두리를 재부착 — 윈도우 rect vs 클라이언트 rect 차이)다. 안정화 루프가 매 폴마다 크롬을 재측정하는데, 총 오프셋 = `frame_nc_border()`(윈도우/클라이언트 rect 차이, 결정론적) + 내부 리본(Basic 세션의 `HwndWrapper` top, 클라이언트 좌표)로 합산한다. 자식 레이아웃 타이밍에 의존하던 옛 측정(`uimainclass` 위치)은 전환 순간 (0,0)에 갇혀 테두리를 못 잡았다 — `frame_nc_border` 기반 측정을 자식 위치 기반으로 되돌리지 말 것.
- **Issue:** Omnissa/Horizon 그리드 임베드 — 창 체인(로그인→데스크톱, 180초 탐색)으로 데스크톱 창 자체는 잡히지만, 슬롯은 **검은 화면**이다 (2026-07-02 확정).
- **Fix(결론): 그리드 임베드 비활성화.** 데스크톱 창의 MKS 표시 자식들(`MKSEmbedded`/`MKSScreenWindow` 등)은 모니터 **절대좌표에 고정**되어(로그: `rect=(1920,0 1920x1080)`) SetParent된 프레임을 전혀 따라오지 않는다. `-desktopLayout windowLarge`로 창 모드를 강제해도 동일. 다시 시도하려면 SetParent 방식이 아니라 Horizon Client SDK 수준의 임베드가 필요하다. 현재는 `SwallowSlot.tsx` 선택기에서 VDI 항목을 disabled("미지원") 처리했고, 원격 자산 페이지의 일반 연결(스왈로우 없음)은 정상. swallow 루프의 체인 추적/180초 연장/`[horizon-scan]` 덤프 코드는 재도전을 위해 남겨 둠.
- **Issue:** React 상태 업데이트 시 창이 깜빡이는 현상.
- **Fix:** `SwallowSlot.tsx`에서 리렌더링이 발생해도 `sync_slot_bounds` 호출을 디바운스(Debounce) 처리함. (현재 16ms)
- **Issue:** 상단 타이틀바(`Topbar.tsx`, `data-tauri-drag-region`)를 잡고 드래그해도 창이 움직이지 않음.
- **Fix:** Tauri v2에서 `data-tauri-drag-region`은 내부적으로 `plugin:window|start_dragging`을 invoke하므로 `src-tauri/capabilities/default.json`에 `core:window:allow-start-dragging` 권한이 **반드시** 있어야 한다. 새 `core:window:allow-*` 권한을 추가/정리할 때 이 권한을 빠뜨리지 말 것 — 빠져도 콘솔에 에러가 안 뜨고 그냥 조용히 드래그만 안 먹는다.
- **Issue:** 멀티뷰에서 swallow된 VM 위에 헤더 UI를 띄우면 겹쳐 보이거나(헤더 중복) 아래쪽 버튼이 안 눌리는 현상 — 극장모드 호버 헤더(`.multiview-header`, `.theater-hit-zone`) 시절부터 반복 재발.
- **Fix:** swallow된 Win32 자식 창은 WebView2 표면 **물리적으로 위**에 있어서 DOM `z-index`로는 절대 못 덮는다. HTML이 VM 위에 보이는 유일한 구간은 각 슬롯 상단 **36px `.slot-header-bar`**(Win32는 그 아래 `.slot-content-area`만 채움). 그래서 극장모드/호버 헤더는 아예 제거했고, 멀티뷰 컨트롤(슬롯 1~4 전환 + 전체화면)은 `MultiView.tsx`가 `headerControls` prop으로 `SwallowSlot`의 슬롯 헤더 바 **안에** 렌더한다. 슬롯 위에 떠 있는 두 번째 헤더/칩/오버레이를 다시 만들지 말 것 — 36px 밴드 밖은 VM에 먹히고, 밴드 안이면 슬롯 헤더와 중복된다. `.control-group`(버튼 28px+패딩 2px=32px)은 36px 안에 들어와야 한다 — `App.css`의 `.control-group`/`.slot-header-bar` 주석을 지우지 말 것.
