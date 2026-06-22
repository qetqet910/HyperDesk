import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { NetworkPage } from "../components/NetworkPage";
import * as tauriApi from "../lib/tauri-api";
import type { VmInfo, VmSwitch, VmNetworkAdapter } from "../types";

const mockVms: VmInfo[] = [
  {
    name: "SRV-01", state: "Running", cpu_usage: 5,
    memory_assigned: 4294967296, memory_demand: 2000000000, memory_startup: 4294967296,
    uptime: "1d", status: "OK", heartbeat: "Ok", memory_status: "Healthy",
    checkpoint_count: 0, ip_addresses: ["10.0.0.1"], generation: 2,
    processor_count: 2, is_pinned: false, tags: [],
  },
];

const mockSwitches: VmSwitch[] = [
  { name: "Default Switch",  switch_type: "Internal", net_adapter_name: "" },
  { name: "External Bridge", switch_type: "External", net_adapter_name: "Realtek PCIe GbE" },
];

const mockAdapters: VmNetworkAdapter[] = [
  { vm_name: "SRV-01", switch_name: "Default Switch" },
];

beforeEach(() => {
  vi.spyOn(tauriApi.api, "getVmSwitches").mockResolvedValue(mockSwitches);
  vi.spyOn(tauriApi.api, "getVmNetworkAdapters").mockResolvedValue(mockAdapters);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NetworkPage", () => {
  it("초기 로딩 상태를 표시한다", () => {
    vi.spyOn(tauriApi.api, "getVmSwitches").mockReturnValue(new Promise(() => {}));
    vi.spyOn(tauriApi.api, "getVmNetworkAdapters").mockReturnValue(new Promise(() => {}));
    render(<NetworkPage vms={mockVms} netHistory={[]} />);
    expect(screen.getByText(/로딩 중/)).toBeInTheDocument();
  });

  it("vSwitch 목록(External Bridge)을 표시한다", async () => {
    render(<NetworkPage vms={mockVms} netHistory={[]} />);
    await waitFor(() => {
      expect(screen.getByText("External Bridge")).toBeInTheDocument();
    });
  });

  it("vSwitch 타입 배지를 표시한다 (INTERNAL, EXTERNAL)", async () => {
    render(<NetworkPage vms={mockVms} netHistory={[]} />);
    await waitFor(() => {
      expect(screen.getByText("INTERNAL")).toBeInTheDocument();
      expect(screen.getByText("EXTERNAL")).toBeInTheDocument();
    });
  });

  it("VM 네트워크 테이블에 VM 이름과 IP를 표시한다", async () => {
    render(<NetworkPage vms={mockVms} netHistory={[]} />);
    await waitFor(() => {
      expect(screen.getByText("SRV-01")).toBeInTheDocument();
      expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    });
  });

  it("VM 테이블에 실제 vSwitch 이름을 표시한다", async () => {
    render(<NetworkPage vms={mockVms} netHistory={[]} />);
    const tables = await screen.findAllByRole("table");
    // 마지막 테이블이 VM 네트워크 테이블
    const vmTable = tables[tables.length - 1];
    await waitFor(() => {
      expect(within(vmTable).getByText("Default Switch")).toBeInTheDocument();
    });
  });

  it("네트워크 I/O 통계를 표시한다", async () => {
    render(
      <NetworkPage
        vms={mockVms}
        statsData={{ cpu: 10, memory_total: 1000, memory_used: 500, uptime: "1d", disk_free: 100, network_io: 2048, cpu_history: [], mem_history: [], net_history: [] }}
        netHistory={[]}
      />
    );
    await waitFor(() => {
      expect(screen.getByText(/KB\/s/)).toBeInTheDocument();
    });
  });

  it("vSwitch 연결 없는 VM은 테이블 switch 컬럼에 '—' 를 표시한다", async () => {
    vi.spyOn(tauriApi.api, "getVmNetworkAdapters").mockResolvedValue([]);
    render(<NetworkPage vms={mockVms} netHistory={[]} />);
    const tables = await screen.findAllByRole("table");
    const vmTable = tables[tables.length - 1];
    await waitFor(() => {
      // switch name column + type column 모두 '—' 가 될 수 있음
      expect(within(vmTable).getAllByText("—").length).toBeGreaterThanOrEqual(1);
    });
  });
});
