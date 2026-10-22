import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "./render";
import { HyperVCard } from "@/components/RackAsset";
import * as tauriApi from "@/lib/tauri-api";
import type { VmInfo } from "@/types";

const vm = (state: string): VmInfo => ({
  name: "SRV-01", state, cpu_usage: 0, memory_assigned: 0, memory_demand: 0, memory_startup: 0,
  uptime: "", status: "", heartbeat: "", memory_status: "", checkpoint_count: 0, ip_addresses: [],
  generation: 2, processor_count: 2, is_pinned: false, tags: [],
});

const withQuery = (ui: ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

afterEach(() => vi.restoreAllMocks());

describe("HyperVCard", () => {
  // 저장됨(Saved)에 종료 버튼이 뜨던 버그 — Start-VM이 저장 시점부터 다시 켠다.
  it.each([["Saved", "시작"], ["Off", "시작"], ["Paused", "재개"], ["Running", "종료"]])(
    "%s 상태의 주 버튼은 '%s'",
    (state, label) => {
      render(withQuery(<HyperVCard vm={vm(state)} />));
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    },
  );

  it("종료는 확인을 받은 뒤에만 Stop-VM을 부른다", async () => {
    const stop = vi.spyOn(tauriApi.api, "stopVm").mockResolvedValue(undefined as never);
    render(withQuery(<HyperVCard vm={vm("Running")} />));
    fireEvent.click(screen.getByRole("button", { name: "종료" }));
    expect(screen.getByText("VM 강제 종료")).toBeInTheDocument();
    expect(stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "강제 종료" }));
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    // TanStack Query v5는 mutationFn에 컨텍스트를 두 번째 인자로 넘긴다 — 첫 인자만 본다.
    expect(stop.mock.calls[0][0]).toBe("SRV-01");
  });
});
