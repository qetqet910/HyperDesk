import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SnapshotsPage } from "@/components/SnapshotsPage";
import * as tauriApi from "@/lib/tauri-api";
import type { VmInfo, VmCheckpoint } from "@/types";

const WAIT = { timeout: 3000 };

const mockVms: VmInfo[] = [
  {
    name: "SRV-TEST-01", state: "Running", cpu_usage: 10,
    memory_assigned: 4294967296, memory_demand: 2000000000, memory_startup: 4294967296,
    uptime: "1d", status: "OK", heartbeat: "Ok", memory_status: "Healthy",
    checkpoint_count: 2, ip_addresses: ["192.168.1.1"], generation: 2,
    processor_count: 4, is_pinned: false, tags: [],
  },
  {
    name: "SRV-TEST-02", state: "Off", cpu_usage: 0,
    memory_assigned: 2147483648, memory_demand: 0, memory_startup: 2147483648,
    uptime: "—", status: "Off", heartbeat: "None", memory_status: "N/A",
    checkpoint_count: 0, ip_addresses: [], generation: 1,
    processor_count: 2, is_pinned: false, tags: [],
  },
];

const mockCheckpoints: VmCheckpoint[] = [
  { name: "Before-Update", vm_name: "SRV-TEST-01", creation_time: "2026-06-01 10:00:00", checkpoint_type: "Standard", parent_checkpoint: undefined },
  { name: "After-Config",  vm_name: "SRV-TEST-01", creation_time: "2026-06-02 09:00:00", checkpoint_type: "Standard", parent_checkpoint: "Before-Update" },
];

beforeEach(() => {
  vi.spyOn(tauriApi.api, "getVmCheckpoints").mockResolvedValue(mockCheckpoints);
  vi.spyOn(tauriApi.api, "checkpointVm").mockResolvedValue(undefined);
  vi.spyOn(tauriApi.api, "restoreVmCheckpoint").mockResolvedValue(undefined);
  vi.spyOn(tauriApi.api, "deleteVmCheckpoint").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SnapshotsPage", () => {
  it("VM이 없으면 '감지된 가상 머신이 없습니다' 를 표시한다", () => {
    render(<SnapshotsPage vms={[]} onSuccess={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText("감지된 가상 머신이 없습니다.")).toBeInTheDocument();
  });

  it("VM 이름들을 렌더링한다", () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText("SRV-TEST-01")).toBeInTheDocument();
    expect(screen.getByText("SRV-TEST-02")).toBeInTheDocument();
  });

  it("VM별 '생성' 버튼(title=새 체크포인트)이 VM 수만큼 렌더링된다", () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    const createBtns = screen.getAllByTitle("새 체크포인트");
    expect(createBtns.length).toBe(mockVms.length);
  });

  it("'생성' 버튼 클릭 시 체크포인트 생성 모달이 열린다", () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    const [firstBtn] = screen.getAllByTitle("새 체크포인트");
    fireEvent.click(firstBtn);
    expect(screen.getByText("체크포인트 생성")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/체크포인트 이름/)).toBeInTheDocument();
  });

  it("체크포인트를 로드 후 목록에 표시한다", async () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText("Before-Update").length).toBeGreaterThan(0);
      expect(screen.getAllByText("After-Config").length).toBeGreaterThan(0);
    }, WAIT);
  });

  it("체크포인트 이름 입력 후 생성하면 checkpointVm API가 호출된다", async () => {
    const onSuccess = vi.fn();
    render(<SnapshotsPage vms={mockVms} onSuccess={onSuccess} onError={vi.fn()} />);
    const [firstBtn] = screen.getAllByTitle("새 체크포인트");
    fireEvent.click(firstBtn);
    fireEvent.change(screen.getByPlaceholderText(/체크포인트 이름/), {
      target: { value: "My-Snapshot" },
    });
    fireEvent.click(screen.getByTestId("modal-create-btn"));
    await waitFor(() => expect(tauriApi.api.checkpointVm).toHaveBeenCalledWith("SRV-TEST-01", "My-Snapshot"), WAIT);
    await waitFor(() => expect(onSuccess).toHaveBeenCalled(), WAIT);
  });

  it("'복원' 버튼 클릭 시 확인 모달이 열린다", async () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    const restoreBtns = await screen.findAllByTestId("restore-checkpoint-btn", {}, { timeout: 3000 });
    fireEvent.click(restoreBtns[0]);
    expect(screen.getByText("체크포인트 복원")).toBeInTheDocument();
    expect(screen.getByText("복원 실행")).toBeInTheDocument();
  });

  it("복원 확인 시 restoreVmCheckpoint API가 호출된다", async () => {
    const onSuccess = vi.fn();
    render(<SnapshotsPage vms={mockVms} onSuccess={onSuccess} onError={vi.fn()} />);
    const restoreBtns = await screen.findAllByTestId("restore-checkpoint-btn", {}, { timeout: 3000 });
    fireEvent.click(restoreBtns[0]);
    fireEvent.click(screen.getByText("복원 실행"));
    await waitFor(() =>
      expect(tauriApi.api.restoreVmCheckpoint).toHaveBeenCalledWith("SRV-TEST-01", "Before-Update"), WAIT
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled(), WAIT);
  });

  it("'삭제' 버튼 클릭 시 확인 모달이 열린다", async () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    const deleteBtns = await screen.findAllByTestId("delete-checkpoint-btn", {}, { timeout: 3000 });
    fireEvent.click(deleteBtns[0]);
    expect(screen.getByText("체크포인트 삭제")).toBeInTheDocument();
    expect(screen.getByText("삭제 실행")).toBeInTheDocument();
  });

  it("삭제 확인 시 deleteVmCheckpoint API가 호출된다", async () => {
    const onSuccess = vi.fn();
    render(<SnapshotsPage vms={mockVms} onSuccess={onSuccess} onError={vi.fn()} />);
    const deleteBtns = await screen.findAllByTestId("delete-checkpoint-btn", {}, { timeout: 3000 });
    fireEvent.click(deleteBtns[0]);
    fireEvent.click(screen.getByText("삭제 실행"));
    await waitFor(() =>
      expect(tauriApi.api.deleteVmCheckpoint).toHaveBeenCalledWith("SRV-TEST-01", "Before-Update"), WAIT
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled(), WAIT);
  });

  it("getVmCheckpoints API 오류 시 에러 메시지를 표시한다", async () => {
    vi.spyOn(tauriApi.api, "getVmCheckpoints").mockRejectedValue(new Error("PowerShell error"));
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText(/PowerShell error/).length).toBeGreaterThan(0);
    }, WAIT);
  });
});
