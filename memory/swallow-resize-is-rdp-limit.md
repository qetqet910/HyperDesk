---
name: swallow-resize-is-rdp-limit
description: HyperDesk swallow "resize 안 됨"의 진짜 원인 — 창 추종은 정상, 내부 해상도는 RDP 한계
metadata:
  type: project
---

HyperDesk에서 RDP/Hyper-V "resize가 안 된다"고 느끼는 증상의 정체 (2026-06-29 dev 로그로 확정):

- **창 틀(swallow된 Win32 프레임)은 즉시 슬롯을 따라간다.** `update_position` → `SetWindowPos`가 동기로 즉시 호출됨. 로그에서 `[update_position] ENTER` 직후 `[reposition]`이 바로 찍히는 것으로 증명됨. SwallowGrid 코드에 resize 버그는 **없다.**
- **늦거나 안 따라오는 건 내부 화면(RDP 비트맵)뿐이다.** 클래식 mstsc는 세션 해상도를 mid-session 재협상 못 함(ActiveX/MSRDC 전용). `smart sizing:i:1`로 비트맵만 스케일. 그래서 키우면 흐려졌다가 늦게 선명, 줄이면 안 돌아옴 — 전부 RDP 프로토콜 한계.
- **Hyper-V(vmconnect)가 Enhanced Session Mode면 내부가 RDP다.** 이때 자식 트리가 `UIMainClass`/`OPWindowClass`/`IHWindowClass` (RDP의 `TscShellContainerClass` 트리와 동일)이고 `HwndWrapper[vmconnect.exe]` 비디오 자식이 **없다**(`vmconnect-video=None`). 그래서 Hyper-V "창은 즉시, 내부 10초 뒤 선명"은 RDP와 **같은 한계**다. Basic Session Mode일 때만 `HwndWrapper[vmconnect.exe;...]` 비디오 자식이 있고 그 top이 chrome 높이(예: 51px).

**동적 해상도(재연결 없이 실제 해상도 변경)는 가능은 하다 — 단 아키텍처가 다르다** (2026-06-29 웹 리서치):
- `mstsc.exe` 별도 프로세스를 swallow하는 현재 방식으로는 **불가**. 프로세스 경계 너머라 그 안의 RDP 컨트롤에 COM 호출을 못 한다. smart sizing 스케일(블러)만 가능.
- 진짜 동적 해상도는 **MSTSCAX ActiveX 컨트롤(`IMsRdpClient9`)을 우리 프로세스에 직접 호스팅**하고 `UpdateSessionDisplaySettings(w,h,...)`를 호출해야 한다. Devolutions MsRdpEx가 이 방식. mstsc.exe를 안 띄운다.
- Tauri+Rust에서 ActiveX/COM 호스팅은 큰 작업(버율 큼) → **2026-06-29 사용자 결정: 안 간다. 현재 스케일(smart sizing) 수용.** connect-time에 풀 해상도로 연결(commands.rs GetSystemMetrics)해서 블러를 줄이는 선까지만.

**Why:** 이 증상으로 매번 swallow.rs resize 로직을 의심하며 헛돈다. 그리고 "RDP는 원래 불가능"도 틀린 결론 — 가능하지만 아키텍처 비용 때문에 안 하기로 한 것.
**How to apply:** "resize/해상도 안 됨" 신고가 오면 먼저 "창 틀이 안 움직이나, 내부 화면만 안 변하나"를 가른다. 창 틀이 즉시 움직이면(로그 `[reposition]` 즉시) 코드 정상. 내부 해상도 추종을 정말 원하면 옵션은 (a) ActiveX 직접 호스팅 재작성, (b) 디바운스 후 재연결 — 둘 다 큰 건. 현재 합의는 스케일 수용. 관련: [[swallow-debug-file-logging]]
