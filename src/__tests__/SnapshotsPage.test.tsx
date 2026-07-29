import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SnapshotsPage } from "@/components/SnapshotsPage";
import * as tauriApi from "@/lib/tauri-api";
import type { VmInfo, VmSnapshot } from "@/types";

/* 이 파일은 전체가 낡아 있었다(11개 전부 실패). 컴포넌트가 "체크포인트"에서
   "스냅샷"으로 개명되면서 UI 문구·API가 모두 바뀌었는데 테스트만 남아 있었다:
     - 모킹 대상이 getVmCheckpoints/checkpointVm/… 였으나 컴포넌트는
       listSnapshots/createSnapshot/… 를 부른다 → 모킹이 아예 안 걸렸다
     - "감지된 가상 머신이 없습니다" → 실제 문구는 "가상 머신 없음"
     - data-testid="restore-checkpoint-btn" 등은 컴포넌트에 존재한 적이 없다
   VM 탭 UI가 추가되면서 VM 이름이 탭과 헤더 두 곳에 나오는 것도 반영한다
   (예전 테스트의 "Found multiple elements" 실패 원인). */

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

const mockSnaps: VmSnapshot[] = [
  { id: "s1", name: "Before-Update", vm_name: "SRV-TEST-01", creation_time: "2026-06-01 10:00:00", snapshot_type: "Standard" },
  { id: "s2", name: "After-Config",  vm_name: "SRV-TEST-01", creation_time: "2026-06-02 09:00:00", snapshot_type: "Standard" },
];

beforeEach(() => {
  vi.spyOn(tauriApi.api, "listSnapshots").mockResolvedValue(mockSnaps);
  vi.spyOn(tauriApi.api, "createSnapshot").mockResolvedValue(undefined as never);
  vi.spyOn(tauriApi.api, "restoreSnapshot").mockResolvedValue(undefined as never);
  vi.spyOn(tauriApi.api, "deleteSnapshot").mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SnapshotsPage", () => {
  it("VM이 없으면 빈 상태를 표시한다", () => {
    render(<SnapshotsPage vms={[]} onSuccess={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText("가상 머신 없음")).toBeInTheDocument();
  });

  it("VM마다 탭을 렌더링한다", () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    // VM 이름은 탭과 VM 헤더 양쪽에 나오므로 getAllByText로 받는다.
    expect(screen.getAllByText("SRV-TEST-01").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("SRV-TEST-02").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("전체 VM")).toBeInTheDocument();
  });

  it("VM마다 '스냅샷 생성' 버튼이 있다", () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    expect(screen.getAllByText("스냅샷 생성")).toHaveLength(mockVms.length);
  });

  it("'스냅샷 생성'을 누르면 이름 입력이 열린다", () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(screen.getAllByText("스냅샷 생성")[0]);
    expect(screen.getByPlaceholderText("스냅샷 이름 (선택)")).toBeInTheDocument();
  });

  it("불러온 스냅샷을 목록에 표시한다", async () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText("Before-Update").length).toBeGreaterThanOrEqual(1);
    }, WAIT);
  });

  it("이름을 넣고 생성하면 createSnapshot이 그 이름으로 호출된다", async () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(screen.getAllByText("스냅샷 생성")[0]);
    fireEvent.change(screen.getByPlaceholderText("스냅샷 이름 (선택)"), { target: { value: "MySnap" } });
    fireEvent.click(screen.getByText("생성"));
    await waitFor(() => {
      expect(tauriApi.api.createSnapshot).toHaveBeenCalledWith("SRV-TEST-01", "MySnap");
    }, WAIT);
  });

  it("'복원'을 누르면 확인 모달이 열린다", async () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    const restore = await screen.findAllByTitle("이 시점으로 복원", {}, WAIT);
    fireEvent.click(restore[0]);
    expect(screen.getByText("스냅샷 복원")).toBeInTheDocument();
  });

  it("복원을 확인하면 restoreSnapshot이 호출된다", async () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    const restore = await screen.findAllByTitle("이 시점으로 복원", {}, WAIT);
    fireEvent.click(restore[0]);
    fireEvent.click(screen.getByText("복원 수행"));
    await waitFor(() => {
      expect(tauriApi.api.restoreSnapshot).toHaveBeenCalledWith("SRV-TEST-01", "Before-Update");
    }, WAIT);
  });

  it("'삭제'를 누르면 확인 모달이 열린다", async () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    const del = await screen.findAllByTitle("스냅샷 삭제", {}, WAIT);
    fireEvent.click(del[0]);
    // 모달 제목과 버튼 title이 같은 문자열이라 모달 안쪽으로 좁혀서 확인한다.
    expect(screen.getByText("영구 삭제")).toBeInTheDocument();
  });

  it("삭제를 확인하면 deleteSnapshot이 호출된다", async () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    const del = await screen.findAllByTitle("스냅샷 삭제", {}, WAIT);
    fireEvent.click(del[0]);
    fireEvent.click(screen.getByText("영구 삭제"));
    await waitFor(() => {
      expect(tauriApi.api.deleteSnapshot).toHaveBeenCalledWith("SRV-TEST-01", "Before-Update");
    }, WAIT);
  });

  it("VM 탭을 고르면 그 VM만 남는다", async () => {
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={vi.fn()} />);
    const tabs = screen.getAllByText("SRV-TEST-02");
    fireEvent.click(tabs[0]);
    await waitFor(() => {
      // 필터가 걸리면 SRV-TEST-01은 탭에만 남는다(VM 헤더가 사라져 개수가 준다).
      expect(screen.getAllByText("SRV-TEST-01")).toHaveLength(1);
    }, WAIT);
  });

  it("listSnapshots가 실패해도 렌더가 죽지 않는다", async () => {
    vi.spyOn(tauriApi.api, "listSnapshots").mockRejectedValue(new Error("PowerShell error"));
    const onError = vi.fn();
    render(<SnapshotsPage vms={mockVms} onSuccess={vi.fn()} onError={onError} />);
    // 목록은 비지만 VM 탭/헤더는 그대로 있어야 한다 — 조회 실패가 페이지를
    // 통째로 날리면 사용자가 재시도 버튼조차 못 누른다.
    await waitFor(() => {
      expect(screen.getAllByText("SRV-TEST-01").length).toBeGreaterThanOrEqual(1);
    }, WAIT);
    expect(screen.getByText("새로고침")).toBeInTheDocument();
  });
});
