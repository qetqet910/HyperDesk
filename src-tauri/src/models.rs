use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VmCheckpoint {
    pub name: String,
    pub vm_name: String,
    pub creation_time: String,
    pub checkpoint_type: String,
    pub parent_checkpoint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VmSwitch {
    pub name: String,
    pub switch_type: String,
    pub net_adapter_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VmNetworkAdapter {
    pub vm_name: String,
    pub switch_name: String,
}

/// One link in a VM's virtual-disk chain (base .vhdx + each checkpoint .avhdx).
/// Surfaced by get_vm_disk_info so the user can see what's actually eating space
/// — a dynamic disk ballooned to its max, plus differencing layers per checkpoint.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VmDiskEntry {
    pub path: String,
    pub disk_type: String,       // "Dynamic" | "Fixed" | "Differencing"
    pub file_size: u64,          // actual bytes on disk NOW
    pub max_size: u64,           // virtual max (what the guest sees)
    pub is_checkpoint: bool,     // Differencing layer (an .avhdx from a checkpoint)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HyperVEvent {
    pub time_created: String,
    pub level: String,
    pub message: String,
    pub event_id: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VmInfo {
    pub name: String,
    pub state: String,
    pub cpu_usage: f64,
    pub memory_assigned: u64,
    pub memory_demand: u64,
    pub memory_startup: u64,
    pub uptime: String,
    pub status: String,
    pub heartbeat: String,
    pub memory_status: String,
    pub checkpoint_count: u32,
    pub ip_addresses: Vec<String>,
    pub generation: u32,
    pub processor_count: u32,
    pub is_pinned: bool,
    pub tags: Vec<String>,
}
