import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { render } from "./render";
import { EventsPage } from "@/components/EventsPage";
import * as tauriApi from "@/lib/tauri-api";

const mockLogs = [
  { id: "1", msg: "[SYSTEM] Booting...", type: "info",    time: "12:00:00" },
  { id: "2", msg: "[SUCCESS] All OK",   type: "success",  time: "12:00:01" },
  { id: "3", msg: "[ERROR] Failed",     type: "error",    time: "12:00:02" },
];

// 페이지가 열리자마자 Hyper-V 이벤트를 불러온다 — 비워 두지 않으면 데모 이벤트의 [정보]
// 태그가 앱 로그 태그와 섞여 아래 단언이 "여러 개 찾음"으로 깨진다.
beforeEach(() => {
  vi.spyOn(tauriApi.api, "getHyperVEvents").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EventsPage", () => {
  it("로그가 없으면 '아직 기록이 없습니다'를 표시한다", () => {
    render(<EventsPage logs={[]} onClear={vi.fn()} />);
    expect(screen.getByText("아직 기록이 없습니다.")).toBeInTheDocument();
  });

  it("로그 항목들을 렌더링한다", () => {
    render(<EventsPage logs={mockLogs} onClear={vi.fn()} />);
    expect(screen.getByText("[SYSTEM] Booting...")).toBeInTheDocument();
    expect(screen.getByText("[SUCCESS] All OK")).toBeInTheDocument();
    expect(screen.getByText("[ERROR] Failed")).toBeInTheDocument();
  });

  it("각 로그의 시간을 표시한다", () => {
    render(<EventsPage logs={mockLogs} onClear={vi.fn()} />);
    expect(screen.getAllByText("12:00:00").length).toBeGreaterThan(0);
  });

  it("지우기 버튼 클릭 시 onClear 콜백을 호출한다", () => {
    const onClear = vi.fn();
    render(<EventsPage logs={mockLogs} onClear={onClear} />);
    fireEvent.click(screen.getByText("지우기"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("로그 종류 태그를 한국어로 렌더링한다 ([정보], [성공], [오류])", () => {
    render(<EventsPage logs={mockLogs} onClear={vi.fn()} />);
    expect(screen.getByText("[정보]")).toBeInTheDocument();
    expect(screen.getByText("[성공]")).toBeInTheDocument();
    expect(screen.getByText("[오류]")).toBeInTheDocument();
  });

  it("페이지를 열면 Hyper-V 이벤트를 바로 불러오고, 새로고침 버튼이 있다", async () => {
    render(<EventsPage logs={[]} onClear={vi.fn()} />);
    expect(screen.getByRole("button", { name: /새로고침/ })).toBeInTheDocument();
    await waitFor(() => expect(tauriApi.api.getHyperVEvents).toHaveBeenCalledTimes(1));
  });

  it("백엔드가 준 수준(warn/error)을 [경고]/[오류]로 보여 준다", async () => {
    vi.mocked(tauriApi.api.getHyperVEvents).mockResolvedValue([
      { time_created: "2026-10-22 09:00:00", level: "warn", event_id: 12030, message: "heartbeat" },
      { time_created: "2026-10-22 09:01:00", level: "error", event_id: 14070, message: "no memory" },
    ]);
    render(<EventsPage logs={[]} onClear={vi.fn()} />);
    expect(await screen.findByText("[경고]")).toBeInTheDocument();
    expect(screen.getByText("[오류]")).toBeInTheDocument();
  });
});
