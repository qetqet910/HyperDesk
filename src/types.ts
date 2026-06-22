export interface VmInfo {
  name: string;
  state: string;
  cpu_usage: number;
  memory_assigned: number;
  memory_demand: number;
  memory_startup: number;
  uptime: string;
  status: string;
  heartbeat: string;
  memory_status: string;
  checkpoint_count: number;
  ip_addresses: string[];
  generation: number;
  processor_count: number;
  is_pinned: boolean;
  tags: string[];
}

export interface RemoteHost {
  id: string;
  name: string;
  host: string;
  username?: string;
  protocol: 'RDP' | 'HORIZON';
  is_detected: boolean; // Registry에서 자동 감지된 항목인지 여부
  status?: string;
  latency?: number;
  load?: number;
  is_hidden: boolean;
  memo?: string;
  tags?: string[];
}

export interface VmSnapshot {
  id: string;
  name: string;
  vm_name: string;
  creation_time: string;
  snapshot_type: string;
}

export interface SystemStats {
  cpu: number;
  memory_total: number;
  memory_used: number;
  uptime: string;
  disk_free: number;
  network_io: number;
  cpu_history: number[];
  mem_history: number[];
  net_history: number[];
}

export interface VmCheckpoint {
  name: string;
  vm_name: string;
  creation_time: string;
  checkpoint_type: string;
  parent_checkpoint?: string;
}

export interface VmSwitch {
  name: string;
  switch_type: string;
  net_adapter_name: string;
}

export interface VmNetworkAdapter {
  vm_name: string;
  switch_name: string;
}

export interface HyperVEvent {
  time_created: string;
  level: string;
  message: string;
  event_id: number;
}

export interface DashboardData {
  vms: VmInfo[];
  vm_error?: string;
  remote_hosts: RemoteHost[];
  system_cpu: number;
  system_memory_total: number;
  system_memory_used: number;
  system_uptime: string;
  system_disk_free: number;
  system_network_io: number;
  cpu_history: number[];
  mem_history: number[];
  net_history: number[];
}
