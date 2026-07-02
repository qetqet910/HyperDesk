import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { DashboardData, SystemStats, VmSnapshot, VmCheckpoint, VmSwitch, VmNetworkAdapter, HyperVEvent } from "../types";

// Helper to provide mock data in non-Tauri environments (like the browser subagent)
const getMockDashboardData = (): DashboardData => ({
  vms: [
    { name: "SRV-PROD-01", state: "Running", cpu_usage: 12.5, memory_assigned: 4294967296, memory_demand: 3221225472, memory_startup: 4294967296, uptime: "2d 4h", status: "Operating normally", heartbeat: "Ok", memory_status: "Healthy", checkpoint_count: 0, ip_addresses: ["192.168.1.10"], generation: 2, processor_count: 4, is_pinned: true, tags: [] },
    { name: "SRV-DEV-02", state: "Off", cpu_usage: 0, memory_assigned: 2147483648, memory_demand: 0, memory_startup: 2147483648, uptime: "—", status: "Off", heartbeat: "None", memory_status: "N/A", checkpoint_count: 2, ip_addresses: [], generation: 1, processor_count: 2, is_pinned: true, tags: [] },
    { name: "SRV-TEST-03", state: "Paused", cpu_usage: 5.2, memory_assigned: 2147483648, memory_demand: 1073741824, memory_startup: 2147483648, uptime: "15h 22m", status: "Paused", heartbeat: "None", memory_status: "Healthy", checkpoint_count: 1, ip_addresses: ["192.168.1.12"], generation: 2, processor_count: 2, is_pinned: false, tags: [] },
    { name: "SRV-BACKUP-04", state: "Running", cpu_usage: 45.1, memory_assigned: 8589934592, memory_demand: 7516192768, memory_startup: 8589934592, uptime: "125d 2h", status: "Backup in progress", heartbeat: "Ok", memory_status: "Healthy", checkpoint_count: 0, ip_addresses: ["192.168.1.50"], generation: 2, processor_count: 8, is_pinned: false, tags: [] },
  ],
  remote_hosts: [
    { id: "1", name: "HQ-GATEWAY", host: "10.0.0.1", username: "admin", protocol: "HORIZON", is_detected: true, status: "Online", latency: 15, load: 24.5, is_hidden: false },
    { id: "2", name: "AWS-RELAY-SEOUL", host: "13.125.x.x", username: "ubuntu", protocol: "RDP", is_detected: false, status: "Online", latency: 42, load: 12.8, is_hidden: false },
  ],
  system_cpu: 24.8,
  system_memory_used: 12582912,
  system_memory_total: 33554432,
  system_uptime: "14d 2h 45m",
  system_disk_free: 450.2,
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
        network_io: d.system_network_io,
        cpu_history: d.cpu_history,
        mem_history: d.mem_history,
        net_history: d.net_history
      } as any;
    }
    if (command === "is_window_valid") return true as any;
    
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
    invoke<void>("add_remote_host", { name, host, protocol, username, tags }),
  removeRemoteHost: (id: string) => invoke<void>("remove_remote_host", { id }),
  updateRemoteHost: (id: string, name: string, host: string, protocol: string, username?: string, tags?: string[]) =>
    invoke<void>("update_remote_host", { id, name, host, protocol, username, tags }),
  startVm: (name: string) => invoke<void>("start_vm", { name }),
  stopVm: (name: string) => invoke<void>("stop_vm", { name }),
  saveVm: (name: string) => invoke<void>("save_vm", { name }),
  resumeVm: (name: string) => invoke<void>("resume_vm", { name }),
  pauseVm: (name: string) => invoke<void>("pause_vm", { name }),
  connectVm: (host: string, protocol: string, username?: string, slotWidth?: number, slotHeight?: number, colorDepth?: number, quality?: string) =>
    invoke<number>("connect_vm", { host, protocol, username, slotWidth, slotHeight, colorDepth, quality }),
  focusSlotWindow: (slotId: string) => invoke<void>("focus_slot_window", { slotId }),
  setFullscreen: (on: boolean) => invoke<void>("set_fullscreen", { on }),
  setImmersive: (on: boolean) => invoke<void>("set_immersive", { on }),
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
  swallowWindow: (slotId: string, pid: number, x: number, y: number, width: number, height: number) => 
    invoke<void>("swallow_window", { slotId, pid, x, y, width, height }),
  unswallowWindow: (slotId: string) => invoke<void>("unswallow_window", { slotId }),
  // DEV-ONLY: spawn a throwaway Win32 window (Character Map) to test SwallowGrid
  // without a real VM/RDP. Backend command exists only in debug builds; callers
  // must gate on import.meta.env.DEV so this is never invoked in production.
  debugSpawnTestWindow: () => invoke<number>("debug_spawn_test_window"),
  syncSlotBounds: (slotId: string, x: number, y: number, width: number, height: number) => 
    invoke<void>("sync_slot_bounds", { slotId, x, y, width, height }),
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
  getVmSwitches: () => invoke<VmSwitch[]>("get_vm_switches"),
  getVmNetworkAdapters: () => invoke<VmNetworkAdapter[]>("get_vm_network_adapters"),
  getHyperVEvents: (maxEvents?: number) => invoke<HyperVEvent[]>("get_hyper_v_events", { maxEvents }),

  getDataDirPath: () => invoke<string>("get_data_dir_path"),
  resetHiddenHosts: () => invoke<void>("reset_hidden_hosts"),
  clearAppData: () => invoke<void>("clear_app_data"),
};
