import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { DashboardData, SystemStats, VmSnapshot, VmCheckpoint, VmSwitch, VmNetworkAdapter, VmDiskEntry, HyperVEvent, RdpLink } from "@/types";

// Helper to provide mock data in non-Tauri environments (like the browser subagent)
// 브라우저 모드(Tauri 밖) 전용 데모 데이터. Store 스크린샷도 이걸로 찍으므로 이름·주소는
// 전부 가상이어야 한다(사설 IP, example 도메인) — 실제 서버/회사 이름을 넣지 말 것.
const GB = 1073741824;
// 데모 문구(메모·스냅샷 이름)를 현재 UI 언어에 맞춘다 — 영어 스크린샷에 한국어가 섞이지 않게.
const demoKo = (() => {
  try { return JSON.parse(localStorage.getItem("hyperdesk_settings") || "{}").lang === "ko"; }
  catch { return false; }
})();
const getMockDashboardData = (): DashboardData => ({
  vms: [
    { name: "WEB-PROD-01", state: "Running", cpu_usage: 23.4, memory_assigned: 8 * GB, memory_demand: 5.6 * GB, memory_startup: 8 * GB, uptime: "12d 4h", status: "Operating normally", heartbeat: "Ok", memory_status: "Healthy", checkpoint_count: 2, ip_addresses: ["10.20.1.11"], generation: 2, processor_count: 4, is_pinned: true, tags: ["prod", "web"] },
    { name: "DB-PROD-01", state: "Running", cpu_usage: 41.8, memory_assigned: 16 * GB, memory_demand: 13.2 * GB, memory_startup: 16 * GB, uptime: "38d 9h", status: "Operating normally", heartbeat: "Ok", memory_status: "Healthy", checkpoint_count: 1, ip_addresses: ["10.20.1.21"], generation: 2, processor_count: 8, is_pinned: true, tags: ["prod", "db"] },
    { name: "APP-STAGING", state: "Running", cpu_usage: 7.2, memory_assigned: 4 * GB, memory_demand: 2.1 * GB, memory_startup: 4 * GB, uptime: "2d 17h", status: "Operating normally", heartbeat: "Ok", memory_status: "Healthy", checkpoint_count: 3, ip_addresses: ["10.20.2.31"], generation: 2, processor_count: 4, is_pinned: false, tags: ["staging"] },
    { name: "BUILD-AGENT-02", state: "Saved", cpu_usage: 0, memory_assigned: 4 * GB, memory_demand: 0, memory_startup: 4 * GB, uptime: "—", status: "Saved", heartbeat: "None", memory_status: "N/A", checkpoint_count: 0, ip_addresses: [], generation: 2, processor_count: 4, is_pinned: false, tags: ["ci"] },
    { name: "WIN11-TEST", state: "Paused", cpu_usage: 0, memory_assigned: 6 * GB, memory_demand: 3.4 * GB, memory_startup: 6 * GB, uptime: "5h 12m", status: "Paused", heartbeat: "None", memory_status: "Healthy", checkpoint_count: 4, ip_addresses: ["10.20.3.41"], generation: 2, processor_count: 2, is_pinned: false, tags: ["test"] },
    { name: "LEGACY-ERP", state: "Off", cpu_usage: 0, memory_assigned: 4 * GB, memory_demand: 0, memory_startup: 4 * GB, uptime: "—", status: "Off", heartbeat: "None", memory_status: "N/A", checkpoint_count: 1, ip_addresses: [], generation: 1, processor_count: 2, is_pinned: false, tags: ["legacy"] },
  ],
  remote_hosts: [
    { id: "1", name: "FILE-SERVER", host: "10.20.1.5", username: "CORP\\admin", protocol: "RDP", is_detected: true, status: "Online", latency: 4, load: 18.2, is_hidden: false, tags: ["infra"], memo: demoKo ? "매일 02:00 백업" : "Nightly backup at 02:00" },
    { id: "2", name: "DEV-WORKSTATION", host: "10.20.4.12", username: "dev", protocol: "RDP", is_detected: true, status: "Online", latency: 7, load: 33.5, is_hidden: false, tags: ["dev"] },
    { id: "3", name: "BRANCH-BUSAN", host: "rdp-busan.corp.example", username: "ops", protocol: "RDP", is_detected: false, status: "Online", latency: 23, load: 12.8, is_hidden: false, tags: ["branch"] },
    { id: "4", name: "JUMP-HOST", host: "jump.corp.example:3390", username: "ops", protocol: "RDP", is_detected: false, status: "Online", latency: 11, load: 6.4, is_hidden: false, tags: ["infra"], memo: demoKo ? "외부 접속용 점프 서버" : "Jump server for external access" },
    { id: "5", name: "LAB-PC-07", host: "10.20.9.7", protocol: "RDP", is_detected: true, status: "TIMEOUT", is_hidden: false, tags: ["lab"] },
    { id: "6", name: "VDI-DESIGN", host: "vdi.corp.example", username: "designer", protocol: "HORIZON", is_detected: true, status: "Online", latency: 15, load: 24.5, is_hidden: false, tags: ["vdi"] },
    { id: "7", name: "VDI-FINANCE", host: "vdi.corp.example", username: "finance", protocol: "HORIZON", is_detected: false, status: "Online", latency: 16, load: 19.1, is_hidden: false, tags: ["vdi"] },
  ],
  system_cpu: 24.8,
  system_memory_used: 12582912,
  system_memory_total: 33554432,
  system_uptime: "14d 2h 45m",
  system_disk_free: 460800, // MB (450 GB) — SystemStats.disk_free 단위와 같다
  system_network_io: 1245.8,
  cpu_history: Array.from({ length: 30 }, () => Math.random() * 40 + 10),
  mem_history: Array.from({ length: 30 }, () => Math.random() * 20 + 40),
  net_history: Array.from({ length: 30 }, () => Math.random() * 1000 + 500),
});

async function invoke<T>(command: string, args: any = {}): Promise<T> {
  // tauriInvoke is always a function reference once imported (even in a plain
  // browser), so `typeof tauriInvoke === 'function'` can't detect whether
  // we're actually inside a Tauri webview. Check the runtime marker instead.
  const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const effectiveInvoke: any = isTauriRuntime ? tauriInvoke : undefined;

  if (typeof effectiveInvoke !== 'function') {
    console.warn(`[HyperDesk] Tauri core not detected. Mocking response for: ${command}`);
    
    if (command === "get_dashboard") return getMockDashboardData() as any;
    if (command === "get_system_stats") {
      const d = getMockDashboardData();
      return {
        cpu: d.system_cpu,
        memory_total: d.system_memory_total,
        memory_used: d.system_memory_used,
        uptime: d.system_uptime,
        disk_free: d.system_disk_free,
        disk_total: d.system_disk_free * 2.2,
        network_io: d.system_network_io,
        cpu_history: d.cpu_history,
        mem_history: d.mem_history,
        net_history: d.net_history
      } as any;
    }
    if (command === "is_window_valid") return true as any;
    // 기본값 `[]`는 truthy라 "링크가 왔다"로 오인된다 — 명시적으로 null.
    if (command === "take_rdp_link") return null as any;
    if (command === "rdp_link_registered") return false as any;
    if (command === "get_vm_switches") return [
      { name: "External-LAN", switch_type: "External", net_adapter_name: "Intel(R) Ethernet Controller I225-V" },
      { name: "Internal-Lab", switch_type: "Internal", net_adapter_name: "" },
      { name: "Default Switch", switch_type: "Internal", net_adapter_name: "" },
    ] as any;
    if (command === "get_vm_network_adapters") return [
      { vm_name: "WEB-PROD-01", switch_name: "External-LAN" },
      { vm_name: "DB-PROD-01", switch_name: "External-LAN" },
      { vm_name: "APP-STAGING", switch_name: "Internal-Lab" },
      { vm_name: "BUILD-AGENT-02", switch_name: "Internal-Lab" },
      { vm_name: "WIN11-TEST", switch_name: "Default Switch" },
      { vm_name: "LEGACY-ERP", switch_name: "Internal-Lab" },
    ] as any;
    if (command === "list_snapshots" || command === "get_vm_checkpoints") {
      const vm = args.vmName ?? args.name ?? "";
      const n = getMockDashboardData().vms.find(v => v.name === vm)?.checkpoint_count ?? 0;
      const labels = demoKo ? ["배포 전", "패치 적용 전", "설정 변경 전", "초기 구성"] : ["before deploy", "before patch", "before config change", "initial setup"];
      return Array.from({ length: n }, (_, i) => {
        const time = `2026-09-${String(26 - i * 3).padStart(2, "0")} 1${i}:30`;
        const name = `${vm} - ${labels[i % labels.length]}`;
        return command === "list_snapshots"
          ? { id: `${vm}-${i}`, name, vm_name: vm, creation_time: time, snapshot_type: "Standard" }
          : { name, vm_name: vm, creation_time: time, checkpoint_type: "Standard" };
      }) as any;
    }
    if (command === "get_hyper_v_events") return [
      { time_created: "2026-09-29 09:24:11", level: "Information", event_id: 18500, message: "'WEB-PROD-01' started successfully." },
      { time_created: "2026-09-29 09:10:42", level: "Information", event_id: 18596, message: "'WIN11-TEST' was paused." },
      { time_created: "2026-09-29 08:55:03", level: "Warning", event_id: 12030, message: "'LAB-PC-07' did not respond to the heartbeat check." },
      { time_created: "2026-09-29 08:31:27", level: "Information", event_id: 18304, message: "Checkpoint created for 'APP-STAGING'." },
      { time_created: "2026-09-28 23:02:15", level: "Information", event_id: 18510, message: "'BUILD-AGENT-02' was saved." },
      { time_created: "2026-09-28 22:47:50", level: "Error", event_id: 14070, message: "'LEGACY-ERP' could not start: not enough memory." },
      { time_created: "2026-09-28 18:12:09", level: "Information", event_id: 18500, message: "'DB-PROD-01' started successfully." },
    ] as any;

    return [] as any; 
  }

  try {
    return await effectiveInvoke(command, args);
  } catch (error) {
    console.error(`Tauri invoke error [${command}]:`, error);
    throw error;
  }
}

export const api = {
  getDashboard: () => invoke<DashboardData>("get_dashboard"),
  getSystemStats: () => invoke<SystemStats>("get_system_stats"),
  addRemoteHost: (name: string, host: string, protocol: string, username?: string, tags?: string[]) =>
    invoke<string>("add_remote_host", { name, host, protocol, username, tags }),
  /** `rdp:` 링크로 실행/호출됐으면 그 대상을 한 번 꺼내 간다(없으면 null). */
  takeRdpLink: () => invoke<RdpLink | null>("take_rdp_link"),
  /** HyperDesk가 `rdp:` 링크를 여는 앱 목록에 등록돼 있는지. */
  rdpLinkRegistered: () => invoke<boolean>("rdp_link_registered"),
  /** 설정의 `rdp:` 링크 등록/해제. 해제하면 다음 실행에도 다시 등록하지 않는다. */
  setRdpLink: (enabled: boolean) => invoke<void>("set_rdp_link", { enabled }),
  removeRemoteHost: (id: string) => invoke<void>("remove_remote_host", { id }),
  updateRemoteHost: (id: string, name: string, host: string, protocol: string, username?: string, tags?: string[]) =>
    invoke<void>("update_remote_host", { id, name, host, protocol, username, tags }),
  createVm: (opts: { name: string; generation: number; memoryGb: number; cpuCount: number; diskGb: number; switchName?: string; isoPath?: string }) =>
    invoke<void>("create_vm", opts),
  startVm: (name: string) => invoke<void>("start_vm", { name }),
  stopVm: (name: string) => invoke<void>("stop_vm", { name }),
  saveVm: (name: string) => invoke<void>("save_vm", { name }),
  resumeVm: (name: string) => invoke<void>("resume_vm", { name }),
  pauseVm: (name: string) => invoke<void>("pause_vm", { name }),
  connectVm: (host: string, protocol: string, username?: string, slotWidth?: number, slotHeight?: number, colorDepth?: number, quality?: string) =>
    invoke<number>("connect_vm", { host, protocol, username, slotWidth, slotHeight, colorDepth, quality }),
  focusSlotWindow: (slotId: string) => invoke<void>("focus_slot_window", { slotId }),
  setConnectLock: (locked: boolean) => invoke<void>("set_connect_lock", { locked }),
  setFullscreen: (on: boolean) => invoke<void>("set_fullscreen", { on }),
  /** 슬롯 전환 단축키 수정자. 전역 단축키 재등록 + LL 훅이 볼 값을 한 번에 바꾼다. */
  quitApp: () => invoke<void>("quit_app"),
  connectConsole: (name: string) => invoke<number>("connect_console", { name }),
  setVmMemory: (name: string, memoryGb: number) => invoke<void>("set_vm_memory", { name, memoryGb }),
  setVmProcessors: (name: string, processors: number) => invoke<void>("set_vm_processors", { name, processors }),
  getVmIp: (name: string) => invoke<string>("get_vm_ip", { name }),
  
  listSnapshots: (vmName: string) => invoke<VmSnapshot[]>("list_snapshots", { vmName }),
  createSnapshot: (vmName: string, snapshotName: string) => invoke<void>("create_snapshot", { vmName, snapshotName }),
  restoreSnapshot: (vmName: string, snapshotName: string) => invoke<void>("restore_snapshot", { vmName, snapshotName }),
  deleteSnapshot: (vmName: string, snapshotName: string) => invoke<void>("delete_snapshot", { vmName, snapshotName }),
  getVmMemo: (vmName: string) => invoke<string>("get_vm_memo", { vmName }),
  setVmMemo: (vmName: string, memo: string) => invoke<void>("set_vm_memo", { vmName, memo }),
  setRemoteHostMemo: (id: string, memo: string) => invoke<void>("set_remote_host_memo", { id, memo }),
  getHorizonPath: () => invoke<string>("get_horizon_path"),
  // expectedTitle: VM name for Hyper-V console connects — vmconnect is
  // single-instance-per-VM (spawned PID may hand off and exit), so the backend
  // hunt matches the window TITLE against it instead of trusting the PID.
  swallowWindow: (slotId: string, pid: number, x: number, y: number, width: number, height: number, expectedTitle?: string) =>
    invoke<void>("swallow_window", { slotId, pid, x, y, width, height, expectedTitle }),
  unswallowWindow: (slotId: string) => invoke<void>("unswallow_window", { slotId }),
  // DEV-ONLY: spawn a throwaway Win32 window (Character Map) to test SwallowGrid
  // without a real VM/RDP. Backend command exists only in debug builds; callers
  // must gate on import.meta.env.DEV so this is never invoked in production.
  debugSpawnTestWindow: () => invoke<number>("debug_spawn_test_window"),
  syncSlotBounds: (slotId: string, x: number, y: number, width: number, height: number) => 
    invoke<void>("sync_slot_bounds", { slotId, x, y, width, height }),
  /** 떠 있는 헤더 필의 자리를 swallow된 자식 창에서 도려낸다. 좌표는 슬롯 콘텐츠
      영역 기준 상대 물리 픽셀. 인자를 생략하면 구멍을 없앤다.
      Win32 자식은 WebView2 위에 그려지므로 이 구멍이 DOM을 VM 위에 띄우는
      유일한 방법이다 — z-index로는 절대 안 된다. */
  setHeaderCutout: (slotId: string, r?: { x: number; y: number; width: number; height: number }) =>
    invoke<void>("set_header_cutout", { slotId, x: r?.x, y: r?.y, width: r?.width, height: r?.height }),
  connectHorizon: (host: string, username?: string) => invoke<number>("connect_horizon", { host, username }),
  checkHost: (host: string, protocol: string) => invoke<number | null>("check_host", { host, protocol }),
  setWindowVisibility: (id: string, visible: boolean) => 
    invoke<void>("set_window_visibility", { slotId: id, visible }),
  isWindowValid: (id: string) => invoke<boolean>("is_window_valid", { slotId: id }),

  getVmTags: (vmName: string) => invoke<string[]>("get_vm_tags", { vmName }),
  setVmTags: (vmName: string, tags: string[]) => invoke<void>("set_vm_tags", { vmName, tags }),
  setRemoteHostTags: (id: string, tags: string[]) => invoke<void>("set_remote_host_tags", { id, tags }),

  getVmCheckpoints: (name: string) => invoke<VmCheckpoint[]>("get_vm_checkpoints", { name }),
  checkpointVm: (name: string, snapshotName: string) => invoke<void>("checkpoint_vm", { name, snapshotName }),
  restoreVmCheckpoint: (vmName: string, checkpointName: string) => invoke<void>("restore_vm_checkpoint", { vmName, checkpointName }),
  deleteVmCheckpoint: (vmName: string, checkpointName: string) => invoke<void>("delete_vm_checkpoint", { vmName, checkpointName }),
  getVmDiskInfo: (name: string) => invoke<VmDiskEntry[]>("get_vm_disk_info", { name }),
  compactVmDisk: (name: string) => invoke<number>("compact_vm_disk", { name }),
  convertVmDiskToDynamic: (name: string) => invoke<number>("convert_vm_disk_to_dynamic", { name }),
  getVmSwitches: () => invoke<VmSwitch[]>("get_vm_switches"),
  getVmNetworkAdapters: () => invoke<VmNetworkAdapter[]>("get_vm_network_adapters"),
  getHyperVEvents: (maxEvents?: number) => invoke<HyperVEvent[]>("get_hyper_v_events", { maxEvents }),

  getDataDirPath: () => invoke<string>("get_data_dir_path"),
  resetHiddenHosts: () => invoke<void>("reset_hidden_hosts"),
  clearAppData: () => invoke<void>("clear_app_data"),
};
