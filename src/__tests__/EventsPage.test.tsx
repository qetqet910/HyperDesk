import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventsPage } from "@/components/EventsPage";

const mockLogs = [
  { id: "1", msg: "[SYSTEM] Booting...", type: "info",    time: "12:00:00" },
  { id: "2", msg: "[SUCCESS] All OK",   type: "success",  time: "12:00:01" },
  { id: "3", msg: "[ERROR] Failed",     type: "error",    time: "12:00:02" },
];

describe("EventsPage", () => {
  // ── 기존 동작 ───────────────────────────────────────────────
  it("로그가 없으면 'No logs recorded' 를 표시한다", () => {
    render(<EventsPage logs={[]} onClear={vi.fn()} />);
    expect(screen.getByText("No logs recorded.")).toBeInTheDocument();
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

  it("Clear 버튼 클릭 시 onClear 콜백을 호출한다", () => {
    const onClear = vi.fn();
    render(<EventsPage logs={mockLogs} onClear={onClear} />);
    fireEvent.click(screen.getByText("Clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("로그 타입 배지를 렌더링한다 ([INFO], [SUCCESS], [ERROR])", () => {
    render(<EventsPage logs={mockLogs} onClear={vi.fn()} />);
    expect(screen.getByText("[INFO]")).toBeInTheDocument();
    expect(screen.getByText("[SUCCESS]")).toBeInTheDocument();
    expect(screen.getByText("[ERROR]")).toBeInTheDocument();
  });

  // ── Feature 4: Get-WinEvent 실데이터 (현재 RED) ─────────────
  it("[F4] 'Hyper-V 이벤트 로드' 버튼이 존재한다", () => {
    render(<EventsPage logs={[]} onClear={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Hyper-V 이벤트 로드/ })).toBeInTheDocument();
  });
});
