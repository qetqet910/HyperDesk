import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { render } from "./render";
import { SettingsPage } from "@/components/SettingsPage";

const savedInterval = () => JSON.parse(localStorage.getItem("hyperdesk_settings")!).pollingInterval;

describe("SettingsPage 새로고침 간격", () => {
  it("칸을 벗어날 때 2~300초로 맞춰 저장하고, 빈칸이면 직전 값으로 돌린다", () => {
    render(<SettingsPage addToast={vi.fn()} />);
    const input = screen.getByLabelText("새로고침 간격") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(input.value).toBe("2");
    expect(savedInterval()).toBe(2000);

    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);
    expect(input.value).toBe("300");
    expect(savedInterval()).toBe(300_000);

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("300");
    expect(savedInterval()).toBe(300_000);
  });

  it("자동 새로고침을 끄면 간격 칸이 비활성이 된다", () => {
    render(<SettingsPage addToast={vi.fn()} />);
    const input = screen.getByLabelText("새로고침 간격");
    expect(input).not.toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "자동 새로고침" }));
    expect(input).toBeDisabled();
  });
});
