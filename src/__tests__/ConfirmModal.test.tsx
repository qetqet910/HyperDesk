import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { render } from "./render";
import { ConfirmModal } from "@/components/ConfirmModal";

describe("ConfirmModal", () => {
  it("부모 안이 아니라 body에 직접 뜬다", () => {
    // 부모에 transform/backdrop-filter가 있으면 position:fixed가 그 부모에 갇힌다(VM 설정 창 안의 확인 창).
    const { container } = render(
      <div style={{ transform: "scale(1)" }}>
        <ConfirmModal title="확인 제목" message="본문" onConfirm={vi.fn()} onClose={vi.fn()} />
      </div>,
    );
    expect(screen.getByText("확인 제목")).toBeInTheDocument();
    expect(container.textContent).not.toContain("확인 제목");
  });

  it("Esc는 이 확인 창만 닫고 App의 전역 Esc 처리기로 넘어가지 않는다", () => {
    // App.tsx는 window keydown(버블)에서 열린 창을 전부 닫는다 — 그게 불리면 VM 설정 창까지 닫힌다.
    const onClose = vi.fn();
    const appEsc = vi.fn();
    window.addEventListener("keydown", appEsc);
    try {
      render(<ConfirmModal title="t" message="m" onConfirm={vi.fn()} onClose={onClose} />);
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(appEsc).not.toHaveBeenCalled();
      // Esc가 아닌 키는 그대로 지나간다.
      fireEvent.keyDown(document.body, { key: "a" });
      expect(appEsc).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", appEsc);
    }
  });
});
