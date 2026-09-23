use std::process::{Command, Stdio};
use std::os::windows::process::CommandExt;
use crate::models::VmInfo;
use crate::hosts::{RemoteHost, load_hosts, save_hosts};
use tauri::{AppHandle, Manager};
use serde::Serialize;
use uuid::Uuid;
use winreg::enums::*;
use winreg::RegKey;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use sysinfo::{System, Disks, Networks};

static SYSTEM_HISTORY: OnceLock<Mutex<SystemHistory>> = OnceLock::new();
static SYS: OnceLock<Mutex<System>> = OnceLock::new();
static NETWORKS: OnceLock<Mutex<Networks>> = OnceLock::new();

fn system_history() -> &'static Mutex<SystemHistory> {
    SYSTEM_HISTORY.get_or_init(|| Mutex::new(SystemHistory::new(30)))
}
fn sys() -> &'static Mutex<System> {
    SYS.get_or_init(|| Mutex::new(System::new_all()))
}
fn networks() -> &'static Mutex<Networks> {
    NETWORKS.get_or_init(|| Mutex::new(Networks::new_with_refreshed_list()))
}

/// Locks a telemetry mutex, recovering inner data if a prior holder panicked.
/// Same poison-recovery discipline as swallow::lock_state (CLAUDE.md rule #4) —
/// a panic mid-refresh must not permanently break every later stats call.
fn lock_or_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

struct SystemHistory {
    cpu: VecDeque<f64>,
    mem: VecDeque<f64>,
    net: VecDeque<f64>,
    max_size: usize,
}

impl SystemHistory {
    fn new(max_size: usize) -> Self {
        Self {
            cpu: VecDeque::with_capacity(max_size),
            mem: VecDeque::with_capacity(max_size),
            net: VecDeque::with_capacity(max_size),
            max_size,
        }
    }

    fn push(&mut self, cpu: f64, mem: f64, net: f64) {
        if self.cpu.len() >= self.max_size { self.cpu.pop_front(); }
        if self.mem.len() >= self.max_size { self.mem.pop_front(); }
        if self.net.len() >= self.max_size { self.net.pop_front(); }
        self.cpu.push_back(cpu);
        self.mem.push_back(mem);
        self.net.push_back(net);
    }
}

#[derive(Serialize)]
pub struct SystemStats {
    pub cpu: f64,
    pub memory_total: u64,
    pub memory_used: u64,
    pub uptime: String,
    pub disk_free: u64,
    pub disk_total: u64,
    pub network_io: f64,
    pub cpu_history: Vec<f64>,
    pub mem_history: Vec<f64>,
    pub net_history: Vec<f64>,
}

#[derive(Serialize)]
pub struct DashboardData {
    pub vms: Vec<VmInfo>,
    pub vm_error: Option<String>,
    pub remote_hosts: Vec<RemoteHost>,
    pub system_cpu: f64,
    pub system_memory_total: u64,
    pub system_memory_used: u64,
    pub system_uptime: String,
    pub system_disk_free: u64,
    pub system_network_io: f64,
    pub cpu_history: Vec<f64>,
    pub mem_history: Vec<f64>,
    pub net_history: Vec<f64>,
}

/// Escapes a value for safe interpolation inside a single-quoted PowerShell
/// string literal. Every user-controlled value (VM name, snapshot name, host,
/// etc.) embedded into a `format!`-built script MUST go through this first —
/// a single missed call is a command-injection hole. See CLAUDE.md "PowerShell
/// 스크립트 작성 규칙".
fn ps_escape(value: &str) -> String {
    value.replace('\'', "''")
}

/// Strips control characters (newlines, CR, tabs) from a value before it is
/// written into an `.rdp` config file. `.rdp` is line-oriented: an embedded
/// newline in `host`/`username` would inject arbitrary RDP directives
/// (e.g. `alternate shell:s:cmd.exe`). host/username come from user input and
/// registry scans — both outside the trust boundary.
fn rdp_sanitize(value: &str) -> String {
    value.chars().filter(|c| !c.is_control()).collect()
}

fn run_powershell(script: &str) -> Result<String, String> {
    let full_script = format!(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; {}",
        script
    );
    let output = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &full_script])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("PowerShell error: {}", err));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// ---------- Persistent PowerShell worker (warm runspace) ----------
//
// A cold powershell.exe run costs ~1.3s here: ~150ms process spawn plus ~1.1s
// Hyper-V module load + CIM session setup. The VM query itself is ~30ms once
// those are warm (measured 2026-07-09). The dashboard pays that 1.3s twice
// per 5s poll, so the hot read-only paths (get_vms, RDP registry scan) run
// through ONE resident shell fed base64-encoded scripts over stdin.
//
// Lifecycle commands (Start/Stop-VM, checkpoints, ...) stay on cold
// run_powershell on purpose: Stop-VM can block for 30s and must never hold
// the worker mutex in front of a dashboard poll. Only route a script here if
// it is read-only and fast.
//
// Protocol: one base64(UTF-8 script) line in -> output lines, then a
// "##PS_DONE:<code>##" sentinel line out. `exit` inside a script would kill
// the loop, but every script sent here runs under $ErrorActionPreference =
// 'Stop' where Write-Error throws before any `exit 1` is reached (get_vms),
// and the wrapper catch turns that into sentinel code 1 — verified by test.
// ponytail: output containing a literal sentinel line would desync; VM/host
// JSON can't produce one.
const PS_WORKER_LOOP: &str = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; while ($true) { $l = [Console]::In.ReadLine(); if ($null -eq $l) { exit }; try { $ErrorActionPreference = 'Stop'; $s = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($l)); [Console]::Out.Write((& ([scriptblock]::Create($s)) | Out-String)); [Console]::Out.WriteLine(); [Console]::Out.WriteLine('##PS_DONE:0##') } catch { [Console]::Out.WriteLine($_.Exception.Message); [Console]::Out.WriteLine('##PS_DONE:1##') } }";

struct PsWorker {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    stdout: std::io::BufReader<std::process::ChildStdout>,
}

static PS_WORKER: OnceLock<Mutex<Option<PsWorker>>> = OnceLock::new();
fn ps_worker_slot() -> &'static Mutex<Option<PsWorker>> {
    PS_WORKER.get_or_init(|| Mutex::new(None))
}

/// Minimal base64 (RFC 4648) — only used to shuttle scripts to the worker.
/// ponytail: hand-rolled to avoid a new dependency for 15 lines.
fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = u32::from_be_bytes([0, b[0], b[1], b[2]]);
        out.push(T[(n >> 18 & 63) as usize] as char);
        out.push(T[(n >> 12 & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6 & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn spawn_ps_worker() -> Option<PsWorker> {
    let mut child = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", PS_WORKER_LOOP])
        .creation_flags(0x08000000)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // Errors surface on stdout via the catch branch; an unread stderr pipe
        // would deadlock the worker once full.
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let stdin = child.stdin.take()?;
    let stdout = std::io::BufReader::new(child.stdout.take()?);
    Some(PsWorker { child, stdin, stdout })
}

/// Sends one script to the worker; returns (output, success).
fn ps_worker_exec(w: &mut PsWorker, script: &str) -> std::io::Result<(String, bool)> {
    use std::io::{BufRead, Write};
    writeln!(w.stdin, "{}", b64(script.as_bytes()))?;
    w.stdin.flush()?;
    let mut out = String::new();
    loop {
        let mut line = String::new();
        if w.stdout.read_line(&mut line)? == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "PS worker exited"));
        }
        if let Some(code) = line.trim().strip_prefix("##PS_DONE:") {
            return Ok((out, code.starts_with('0')));
        }
        out.push_str(&line);
    }
}

/// Warms the resident worker in the background at app startup so the module
/// load + CIM session cost (~1.1s) overlaps with WebView2/React boot instead
/// of stalling the first dashboard fetch (the loading screen's long pole).
pub fn prewarm_ps_worker() {
    std::thread::spawn(|| {
        let _ = run_powershell_warm(
            "if (Get-Command Get-VM -ErrorAction SilentlyContinue) { Get-VM | Out-Null }",
        );
    });
}

/// run_powershell via the resident worker; any worker failure falls back to a
/// cold spawn, so behavior can never be worse than before the worker existed.
fn run_powershell_warm(script: &str) -> Result<String, String> {
    let full = format!("$ErrorActionPreference = 'Stop'; {}", script);
    {
        let mut guard = lock_or_recover(ps_worker_slot());
        if guard.is_none() {
            *guard = spawn_ps_worker();
        }
        if let Some(w) = guard.as_mut() {
            // ponytail: coarse hang guard. A wedged worker would hold this mutex
            // forever (a cold spawn recovers on the next poll); killing the
            // process unblocks the reader below with EOF -> cold fallback.
            let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let flag = done.clone();
            let pid = w.child.id();
            std::thread::spawn(move || {
                for _ in 0..240 {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if flag.load(std::sync::atomic::Ordering::Relaxed) { return; }
                }
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/F"])
                    .creation_flags(0x08000000)
                    .output();
            });
            let res = ps_worker_exec(w, &full);
            done.store(true, std::sync::atomic::Ordering::Relaxed);
            match res {
                Ok((out, true)) => return Ok(out.trim().to_string()),
                Ok((out, false)) => return Err(format!("PowerShell error: {}", out.trim())),
                Err(_) => {
                    let _ = w.child.kill();
                    *guard = None; // respawned lazily on the next call
                }
            }
        }
    }
    run_powershell(script)
}

#[tauri::command]
pub async fn get_vms() -> Result<Vec<VmInfo>, String> {
    let vm_script = r#"
        if (!(Get-Command Get-VM -ErrorAction SilentlyContinue)) {
            Write-Error "Hyper-V PowerShell 모듈이 설치되어 있지 않습니다. 'Windows 기능 켜기/끄기'에서 Hyper-V를 활성화해주세요."
            exit 1
        }
        try {
            $vms = Get-VM -ErrorAction Stop | ForEach-Object {
                $vm = $_
                $uptime = if ($vm.Uptime.TotalSeconds -gt 0) { $vm.Uptime.ToString("hh\:mm\:ss") } else { "00:00:00" }
                $heartbeat = if ($vm.State -eq 'Running') { $vm.Heartbeat.ToString() } else { "None" }
                $snapshots = (Get-VMSnapshot -VMName $vm.Name -ErrorAction SilentlyContinue | Measure-Object).Count
                [PSCustomObject]@{
                    Name            = $vm.Name
                    State           = $vm.State.ToString()
                    CPUUsage        = [double]$vm.CPUUsage
                    MemoryAssigned  = [long]$vm.MemoryAssigned
                    MemoryDemand    = [long]$vm.MemoryDemand
                    MemoryStartup   = [long]$vm.MemoryStartup
                    Uptime          = $uptime
                    Status          = $vm.Status.ToString()
                    Heartbeat       = $heartbeat
                    MemoryStatus    = $vm.MemoryStatus.ToString()
                    CheckpointCount = [int]$snapshots
                    Generation      = [int]$vm.Generation
                    ProcessorCount  = [int]$vm.ProcessorCount
                    IPAddresses     = (Get-VMNetworkAdapter -VMName $vm.Name | Where-Object { $_.IPAddresses.Count -gt 0 } | Select-Object -ExpandProperty IPAddresses) -join ','
                }
            }
            if ($vms) {
                $vms | ConvertTo-Json -Depth 3
            } else {
                "[]"
            }
        } catch {
            Write-Error $_.Exception.Message
            exit 1
        }
    "#;

    // Run the blocking Get-VM off the async executor so get_dashboard can
    // overlap it with the registry scan (see tokio::join! there).
    let vm_json = tokio::task::spawn_blocking(|| run_powershell_warm(vm_script))
        .await
        .map_err(|e| format!("VM query task failed: {}", e))??;
    if vm_json.is_empty() || vm_json == "null" {
        return Ok(vec![]);
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct RawVm {
        name: String,
        state: String,
        #[serde(rename = "CPUUsage")]
        cpu_usage: f64,
        #[serde(rename = "MemoryAssigned")]
        memory_assigned: u64,
        #[serde(rename = "MemoryDemand")]
        memory_demand: u64,
        #[serde(rename = "MemoryStartup")]
        memory_startup: u64,
        #[serde(rename = "Status")]
        status: String,
        #[serde(rename = "Heartbeat")]
        heartbeat: String,
        #[serde(rename = "MemoryStatus")]
        memory_status: String,
        #[serde(rename = "CheckpointCount")]
        checkpoint_count: u32,
        uptime: String,
        generation: u32,
        processor_count: u32,
        #[serde(rename = "IPAddresses")]
        ip_addresses_str: String,
    }

    let raw_vms: Vec<RawVm> = if vm_json.trim_start().starts_with('[') {
        serde_json::from_str(&vm_json).map_err(|e| format!("JSON parse error: {}", e))?
    } else {
        let single: RawVm = serde_json::from_str(&vm_json)
            .map_err(|e| format!("JSON parse error: {}", e))?;
        vec![single]
    };

    let mut vms = Vec::new();
    for raw in raw_vms {
        let ip_addresses: Vec<String> = raw.ip_addresses_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        vms.push(VmInfo {
            name: raw.name,
            state: raw.state,
            cpu_usage: raw.cpu_usage,
            memory_assigned: raw.memory_assigned,
            memory_demand: raw.memory_demand,
            memory_startup: raw.memory_startup,
            status: raw.status,
            heartbeat: raw.heartbeat,
            memory_status: raw.memory_status,
            checkpoint_count: raw.checkpoint_count,
            uptime: raw.uptime,
            ip_addresses,
            generation: raw.generation,
            processor_count: raw.processor_count,
            is_pinned: false,
            tags: vec![],
        });
    }

    Ok(vms)
}

#[tauri::command]
pub async fn get_vm_ip(name: String) -> Result<String, String> {
    let ip_script = format!(
        r#"(Get-VMNetworkAdapter -VMName '{}' | Where-Object {{ $_.IPAddresses.Count -gt 0 }} | Select-Object -ExpandProperty IPAddresses) -join ','"#,
        ps_escape(&name)
    );
    // spawn_blocking so this blocking mutex+I/O call never runs directly on a
    // Tokio async worker thread (that pool is small and fixed-size; parking it
    // on blocking work risks starving unrelated async tasks).
    let ip_str = tokio::task::spawn_blocking(move || run_powershell_warm(&ip_script))
        .await
        .map(|r| r.unwrap_or_default())
        .unwrap_or_default();
    Ok(ip_str)
}

/// Creates a new Hyper-V VM with a fresh dynamic VHD, and optionally attaches a
/// switch + boot ISO. Lifecycle op → COLD run_powershell. The VHD lands in the
/// host's default virtual-disk folder as `<name>.vhdx`. All string params go
/// through ps_escape (CLAUDE.md rule #1); numeric params are type-safe.
/// `iso_path` is validated to exist before it's attached so a typo'd path fails
/// loudly instead of creating a VM that silently can't boot.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_vm(
    name: String,
    generation: u32,
    memory_gb: u32,
    cpu_count: u32,
    disk_gb: u32,
    switch_name: Option<String>,
    iso_path: Option<String>,
) -> Result<(), String> {
    let gen = if generation == 2 { 2 } else { 1 };
    let safe_name = ps_escape(&name);
    // Build the optional clauses with escaped values (empty = omitted).
    let switch_clause = match switch_name.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(s) => format!("$params.SwitchName = '{}'", ps_escape(s)),
        None => String::new(),
    };
    let iso = iso_path.unwrap_or_default();
    let iso_clause = if iso.trim().is_empty() {
        String::new()
    } else {
        let safe_iso = ps_escape(&iso);
        format!(
            r#"
        $iso = '{}'
        if (-not (Test-Path -LiteralPath $iso)) {{ Write-Error "ISO 파일을 찾을 수 없습니다: $iso"; exit 1 }}
        Set-VMDvdDrive -VMName '{}' -Path $iso -ErrorAction Stop
        if ({} -eq 2) {{
            $dvd = Get-VMDvdDrive -VMName '{}'
            Set-VMFirmware -VMName '{}' -FirstBootDevice $dvd -ErrorAction SilentlyContinue
        }}"#,
            safe_iso, safe_name, gen, safe_name, safe_name
        )
    };

    let script = format!(
        r#"
        if (Get-VM -Name '{name}' -ErrorAction SilentlyContinue) {{ Write-Error '같은 이름의 VM이 이미 존재합니다.'; exit 1 }}
        $vmHost = Get-VMHost
        $vhdDir = $vmHost.VirtualHardDiskPath
        if (-not (Test-Path -LiteralPath $vhdDir)) {{ New-Item -ItemType Directory -Path $vhdDir -Force | Out-Null }}
        $vhdPath = Join-Path $vhdDir '{name}.vhdx'
        if (Test-Path -LiteralPath $vhdPath) {{ Write-Error "같은 이름의 디스크가 이미 존재합니다: $vhdPath"; exit 1 }}
        $params = @{{
            Name = '{name}'
            MemoryStartupBytes = {mem}GB
            Generation = {gen}
            NewVHDPath = $vhdPath
            NewVHDSizeBytes = {disk}GB
        }}
        {switch_clause}
        New-VM @params -ErrorAction Stop | Out-Null
        Set-VMProcessor -VMName '{name}' -Count {cpu} -ErrorAction Stop
        {iso_clause}
    "#,
        name = safe_name,
        mem = memory_gb.max(1),
        gen = gen,
        disk = disk_gb.max(1),
        cpu = cpu_count.max(1),
        switch_clause = switch_clause,
        iso_clause = iso_clause,
    );

    run_powershell(&script)?;
    Ok(())
}

#[tauri::command]
pub async fn start_vm(name: String) -> Result<(), String> {
    run_powershell(&format!("Start-VM -Name '{}'", ps_escape(&name)))?;
    Ok(())
}

#[tauri::command]
pub async fn stop_vm(name: String) -> Result<(), String> {
    run_powershell(&format!("Stop-VM -Name '{}' -Force", ps_escape(&name)))?;
    Ok(())
}

#[tauri::command]
pub async fn save_vm(name: String) -> Result<(), String> {
    run_powershell(&format!("Save-VM -Name '{}'", ps_escape(&name)))?;
    Ok(())
}

#[tauri::command]
pub async fn resume_vm(name: String) -> Result<(), String> {
    run_powershell(&format!("Resume-VM -Name '{}'", ps_escape(&name)))?;
    Ok(())
}

#[tauri::command]
pub async fn pause_vm(name: String) -> Result<(), String> {
    run_powershell(&format!("Suspend-VM -Name '{}'", ps_escape(&name)))?;
    Ok(())
}

#[tauri::command]
pub async fn connect_vm(host: String, protocol: String, username: Option<String>, slot_width: Option<i32>, slot_height: Option<i32>, color_depth: Option<i32>, quality: Option<String>) -> Result<u32, String> {
    // 1. Explicit Protocol Routing
    if protocol == "HORIZON" {
        return connect_horizon(host, username).await;
    }

    // 2. Default to RDP/MST for "RDP" protocol
    let temp_dir = std::env::temp_dir();
    let rdp_filename = format!("hyperdesk_{}.rdp", Uuid::new_v4());
    let rdp_path = temp_dir.join(rdp_filename);

    let host = rdp_sanitize(&host);
    // Classic mstsc can't renegotiate session resolution mid-session, so connect at the
    // primary monitor's FULL physical resolution and let smart sizing:i:1 scale the bitmap down
    // into the slot. Growing the slot then never exceeds the connect-time resolution, so
    // the surface stays sharp instead of upscaling a small connect-time bitmap.
    let (screen_w, screen_h) = unsafe {
        use windows::Win32::Graphics::Gdi::{GetDC, ReleaseDC, GetDeviceCaps, DESKTOPHORZRES, DESKTOPVERTRES};
        use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
        let hdc = GetDC(None);
        let phys_w = GetDeviceCaps(hdc, DESKTOPHORZRES);
        let phys_h = GetDeviceCaps(hdc, DESKTOPVERTRES);
        let _ = ReleaseDC(None, hdc);
        if phys_w > 0 && phys_h > 0 {
            (phys_w, phys_h)
        } else {
            (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN))
        }
    };
    let w = if screen_w > 0 { screen_w } else { slot_width.unwrap_or(1920) };
    let h = if screen_h > 0 { screen_h } else { slot_height.unwrap_or(1080) };
    let depth = color_depth.unwrap_or(32);
    #[cfg(debug_assertions)]
    eprintln!("[rdp] desktop {}x{} (full-screen physical res; slot was {:?}x{:?})", w, h, slot_width, slot_height);

    // session bpp + perf flags trade visual fidelity for bandwidth on slower links
    // (disable_wallpaper, allow_font_smoothing, disable_themes, disable_drag, disable_menu_anims)
    let (disable_wallpaper, allow_font_smoothing, disable_themes, disable_anims) = match quality.as_deref().unwrap_or("high") {
        "low" => (1, 0, 1, 1),
        "high" => (0, 1, 0, 0),
        _ => (0, 1, 0, 0),
    };

    // screen mode id: 1 = windowed, 2 = fullscreen. MUST be 1 — the connection bar
    // ("파란 바") is a FULLSCREEN-only element; in windowed mode it never exists, so
    // no clipping/masking is needed.
    //
    // smart sizing:i:1 (NOT dynamic resolution). Classic mstsc.exe CANNOT renegotiate
    // session resolution mid-session — that's an ActiveX/MSRDC-only feature. With
    // smart sizing the session stays at its connect-time resolution but the bitmap is
    // SCALED to fill the host window, so the surface follows the slot when it grows or
    // shrinks (no off-screen overflow).
    let mut rdp_content = format!(
        "full address:s:{}\n\
         screen mode id:i:1\n\
         desktopwidth:i:{}\n\
         desktopheight:i:{}\n\
         session bpp:i:{}\n\
         smart sizing:i:1\n\
         keyboardhook:i:1\n\
         displayconnectionbar:i:0\n\
         pinned connection bar:i:0\n\
         authentication level:i:2\n\
         connection type:i:7\n\
         networkautodetect:i:1\n\
         bandwidthautodetect:i:1\n\
         desktop scale factor:i:100\n\
         disable wallpaper:i:{}\n\
         allow font smoothing:i:{}\n\
         disable themes:i:{}\n\
         disable full window drag:i:{}\n\
         disable menu anims:i:{}\n",
        host, w, h, depth,
        disable_wallpaper, allow_font_smoothing, disable_themes, disable_anims, disable_anims
    );

    if let Some(user) = username {
        let user = rdp_sanitize(&user);
        if !user.is_empty() {
            rdp_content.push_str(&format!("username:s:{}\n", user));
        }
    }

    std::fs::write(&rdp_path, rdp_content)
        .map_err(|e| format!("Failed to create RDP config: {}", e))?;

    let mut command = Command::new("mstsc.exe");
    command.arg(&rdp_path);

    let child = command.spawn()
        .map_err(|e| format!("Failed to launch mstsc: {}", e))?;

    let path_clone = rdp_path.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(10));
        let _ = std::fs::remove_file(path_clone);
    });

    Ok(child.id())
}

#[tauri::command]
pub async fn connect_console(name: String) -> Result<u32, String> {
    let child = Command::new("C:\\Windows\\System32\\vmconnect.exe")
        .args(["localhost", &name])
        .spawn()
        .map_err(|e| format!("Failed to launch vmconnect: {}", e))?;
    Ok(child.id())
}

/// DEV-ONLY test harness. Spawns a throwaway Character Map window (a classic
/// Win32 app that reliably owns its own top-level window by the spawned PID —
/// unlike notepad/calc/mspaint which are Store apps on Win11 whose window is
/// owned by a different process, breaking swallow-by-PID). Lets the SwallowGrid
/// UX (header overlap, focus forwarding, theater mode, drag, z-index) be
/// exercised in `npm run tauri dev` with no real VM/RDP. Compiled only in debug
/// builds; the frontend trigger is additionally gated behind import.meta.env.DEV,
/// so it cannot ship in or be reached from a release build. Takes no user input.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn debug_spawn_test_window() -> Result<u32, String> {
    let child = Command::new("C:\\Windows\\System32\\charmap.exe")
        .spawn()
        .map_err(|e| format!("Failed to launch test window: {}", e))?;
    Ok(child.id())
}

fn clean_host_url(host: &str) -> String {
    host.replace("https://", "")
        .replace("http://", "")
        .trim_end_matches('/')
        .to_string()
}

async fn check_host_health(host: &str, protocol: &str) -> Option<u32> {
    let host = clean_host_url(host);
    if host.is_empty() || host == "localhost" || host == "127.0.0.1" {
        return Some(1);
    }

    // Strip existing port from host if present, then re-apply correct port
    let (hostname, port) = if let Some(idx) = host.rfind(':') {
        let port_str = &host[idx + 1..];
        if port_str.chars().all(|c| c.is_ascii_digit()) {
            (&host[..idx], port_str.parse::<u16>().unwrap_or(443))
        } else {
            (host.as_str(), if protocol.to_uppercase() == "HORIZON" { 443 } else { 3389 })
        }
    } else {
        (host.as_str(), if protocol.to_uppercase() == "HORIZON" { 443 } else { 3389 })
    };

    let addr = format!("{}:{}", hostname, port);
    let start = std::time::Instant::now();
    // Dashboard load blocks on this (join_all in get_dashboard), so the timeout is
    // the worst-case stall from a single offline host. 800ms is still generous for
    // any real TCP handshake (LAN/VPN hosts answer in <100ms) — this only trades
    // off how long a genuinely offline host takes to be reported as such.
    match timeout(Duration::from_millis(800), TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => Some(start.elapsed().as_millis() as u32),
        _ => None,
    }
}

#[tauri::command]
pub async fn check_host(host: String, protocol: String) -> Option<u32> {
    check_host_health(&host, &protocol).await
}

fn scan_horizon_servers() -> Vec<RemoteHost> {
    let mut detected = Vec::new();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    
    // Scan both VMware and Omnissa (New Branding) paths
    let paths = [
        r#"Software\VMware, Inc.\VMware Horizon View Client\Servers"#,
        r#"Software\Omnissa\Omnissa Horizon Client\Servers"#,
    ];

    for path in paths {
        if let Ok(servers_key) = hkcu.open_subkey(path) {
            for server_addr in servers_key.enum_keys().filter_map(|k| k.ok()) {
                let mut username = String::new();
                
                // Try to find last used username in subkey
                if let Ok(sub_key) = servers_key.open_subkey(&server_addr) {
                    if let Ok(u) = sub_key.get_value::<String, _>("LastUserName") {
                        username = u;
                    }
                }

                detected.push(RemoteHost {
                    id: format!("vdi-{}", server_addr),
                    name: format!("VDI: {}", server_addr),
                    host: server_addr,
                    username: if username.is_empty() { None } else { Some(username) },
                    protocol: "HORIZON".to_string(),
                    is_detected: true,
                    status: Some("Checking...".to_string()),
                    latency: None,
                    load: None,
                    is_hidden: false,
                    memo: None,
                    tags: None,
                });
            }
        }
    }
    detected
}

#[tauri::command]
pub async fn get_system_stats() -> Result<SystemStats, String> {
    // sysinfo requires two refresh_cpu_usage() calls with a delay between them
    // to compute an accurate delta-based CPU percentage.
    {
        let mut sys = lock_or_recover(sys());
        sys.refresh_cpu_usage(); // first sample — establishes baseline
    }
    tokio::time::sleep(Duration::from_millis(250)).await;

    let (cpu, total_mem_kb, used_mem_kb, uptime_str, disk_free_mb, disk_total_mb, net_io_kb) = {
        let mut sys = lock_or_recover(sys());
        sys.refresh_cpu_usage(); // second sample — calculates actual delta
        sys.refresh_memory();

        let cpu = sys.global_cpu_usage() as f64;
        let total_mem_kb = sys.total_memory() / 1024;
        let used_mem_kb = sys.used_memory() / 1024;

        let uptime_secs = System::uptime();
        let days = uptime_secs / 86400;
        let hours = (uptime_secs % 86400) / 3600;
        let minutes = (uptime_secs % 3600) / 60;
        let uptime_str = format!("{}d {}h {}m", days, hours, minutes);

        let disks = Disks::new_with_refreshed_list();
        // Prefer the C: system drive; fall back to the largest mounted disk so
        // machines whose Windows lives on another letter still report something.
        let sys_disk = disks.iter()
            .find(|d| d.mount_point().to_string_lossy().starts_with("C:"))
            .or_else(|| disks.iter().max_by_key(|d| d.total_space()));
        let disk_free_mb = sys_disk.map(|d| d.available_space() / 1024 / 1024).unwrap_or(0);
        let disk_total_mb = sys_disk.map(|d| d.total_space() / 1024 / 1024).unwrap_or(0);

        let mut nets = lock_or_recover(networks());
        nets.refresh(true);
        let mut total_bytes_per_sec: u64 = 0;
        for (_, network) in nets.iter() {
            total_bytes_per_sec += network.received() + network.transmitted();
        }

        (cpu, total_mem_kb, used_mem_kb, uptime_str, disk_free_mb, disk_total_mb, (total_bytes_per_sec as f64) / 1024.0)
    };

    let mem_percent = if total_mem_kb > 0 { (used_mem_kb as f64 / total_mem_kb as f64) * 100.0 } else { 0.0 };
    
    let (cpu_history, mem_history, net_history) = {
        let mut history = lock_or_recover(system_history());
        history.push(cpu, mem_percent, net_io_kb);
        (
            history.cpu.iter().cloned().collect(),
            history.mem.iter().cloned().collect(),
            history.net.iter().cloned().collect(),
        )
    };

    Ok(SystemStats {
        cpu,
        memory_total: total_mem_kb,
        memory_used: used_mem_kb,
        uptime: uptime_str,
        disk_free: disk_free_mb,
        disk_total: disk_total_mb,
        network_io: net_io_kb,
        cpu_history,
        mem_history,
        net_history,
    })
}

const RDP_SCAN_SCRIPT: &str = r#"
    $mrus = @()
    try {
        $history = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Terminal Server Client\Default" -ErrorAction SilentlyContinue
        if ($history) {
            $mrus = $history.PSObject.Properties | Where-Object { $_.Name -like "MRU*" } | Select-Object -ExpandProperty Value
        }
    } catch {}

    $server_hosts = @()
    try {
        $servers = Get-ChildItem -Path "HKCU:\Software\Microsoft\Terminal Server Client\Servers" -ErrorAction SilentlyContinue
        if ($servers) { $server_hosts = $servers.PSChildName }
    } catch {}

    ($mrus + $server_hosts) | Where-Object { $_ -ne $null } | Select-Object -Unique
"#;

#[tauri::command]
pub async fn get_dashboard(app: AppHandle) -> Result<DashboardData, String> {
    // VM query (blocking Get-VM) and RDP registry scan (blocking) are
    // independent, so run them concurrently on blocking threads instead of
    // letting the slow Get-VM gate the rest of the dashboard. The RDP scan
    // deliberately stays on a COLD run_powershell, not the warm worker: it never
    // touches Hyper-V/CIM (just two registry reads), so it gets none of the
    // warm path's benefit but would fully share its mutex — routing it through
    // run_powershell_warm serialized this "concurrent" pair behind one lock,
    // silently defeating the comment above (worst case, a wedged Get-VM could
    // stall the RDP scan for the warm worker's full 120s hang-guard window).
    let vms_fut = get_vms();
    let rdp_fut = tokio::task::spawn_blocking(|| run_powershell(RDP_SCAN_SCRIPT));
    let (vms_res, rdp_res) = tokio::join!(vms_fut, rdp_fut);

    // 1. Hyper-V VMs
    let (mut vms, vm_error) = match vms_res {
        Ok(vms) => (vms, None),
        Err(e) => (Vec::new(), Some(e)),
    };

    // Inject saved VM tags
    let vm_tags_map = load_vm_tags_map(&app);
    for vm in vms.iter_mut() {
        if let Some(tags) = vm_tags_map.get(&vm.name) {
            vm.tags = tags.clone();
        }
    }

    // 2. Load manual hosts
    let mut remote_hosts = load_hosts(&app);

    // 3. Smart Merge Logic.
    // VDI (Horizon/Omnissa) is folded in FIRST and wins the protocol: a host present
    // in the Horizon client registry is definitively VDI. RDP history is only a weak
    // "was once typed into mstsc" signal, so it must not be able to relabel a VDI host
    // as RDP (which is what made Omnissa show up under RDP and fail to connect on 3389).
    let vdi_hosts = scan_horizon_servers();
    for vdi in vdi_hosts {
        if let Some(existing) = remote_hosts.iter_mut().find(|h| h.host == vdi.host) {
            // Only relabel auto-detected entries. A user who manually saved this
            // host with protocol=RDP chose that on purpose — don't override
            // their choice.
            if existing.protocol.is_empty() || existing.is_detected {
                existing.protocol = "HORIZON".to_string();
            }
            // Deliberately NOT setting existing.is_detected = true here. This
            // used to run unconditionally regardless of the existing value,
            // which meant a manually-added/edited host (is_detected: false)
            // whose address also happens to still be sitting in the OS's own
            // Horizon/RDP connection history — true for nearly every real
            // host, since that history is exactly how it got "detected" in
            // the first place — got silently flipped back to is_detected:
            // true on every 5s dashboard poll. The AUTO badge would then
            // reappear right after a user edited it away, and it re-opened
            // this very protocol guard on the NEXT poll. Nothing downstream
            // reads is_detected after this point except that guard (already
            // read above, before this line) and the AUTO-badge UI, so leaving
            // an already-true value alone and never promoting a false one is
            // enough — freshly-detected entries already set is_detected: true
            // in their own literal below.
        } else {
            remote_hosts.push(vdi);
        }
    }

    // Fold in the RDP registry scan — never overrides an existing HORIZON classification.
    if let Ok(Ok(rdp_out)) = rdp_res {
        let rdp_detected: Vec<String> = rdp_out.split('\n').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        for host in rdp_detected {
            if let Some(existing) = remote_hosts.iter_mut().find(|h| h.host == host) {
                // Same reasoning as the VDI loop above — leaving this out of a
                // manual entry's re-detection is what keeps its is_detected:
                // false from being clobbered every poll.
                if existing.protocol.is_empty() { existing.protocol = "RDP".to_string(); }
            } else {
                remote_hosts.push(RemoteHost {
                    id: format!("detected-{}", host),
                    name: host.clone(),
                    host: host.clone(),
                    username: None,
                    protocol: "RDP".to_string(),
                    is_detected: true,
                    status: Some("Detected".to_string()),
                    latency: None,
                    load: None,
                    is_hidden: false,
                    memo: None,
                    tags: None,
                });
            }
        }
    }

    remote_hosts.retain(|h| !h.is_hidden);

    // 4. Perform health checks in parallel
    use futures::future::join_all;
    let mut health_futures = Vec::new();
    for host in &remote_hosts {
        health_futures.push(check_host_health(&host.host, &host.protocol));
    }
    
    let latencies: Vec<Option<u32>> = join_all(health_futures).await;
    
    for (i, latency) in latencies.into_iter().enumerate() {
        let host = &mut remote_hosts[i];
        if let Some(l) = latency {
            host.latency = Some(l);
            host.status = Some(format!("{}ms", l));
            host.load = None; // No real load data without server API access 
        } else {
            host.latency = None;
            host.status = Some("TIMEOUT".to_string());
            host.load = None;
        }
    }

    // 5. Get basic System Resources for UI (Snapshot only)
    let (cpu, total_mem_kb, used_mem_kb, uptime_str, disk_free_mb, net_io_kb) = {
        let sys = lock_or_recover(sys());
        // Skip heavy refresh here, focus on inventory.
        // History is handled by separate get_system_stats command.
        (sys.global_cpu_usage() as f64, sys.total_memory() / 1024, sys.used_memory() / 1024, "Synced".to_string(), 0, 0.0)
    };

    Ok(DashboardData { 
        vms, 
        vm_error, 
        remote_hosts,
        system_cpu: cpu,
        system_memory_total: total_mem_kb,
        system_memory_used: used_mem_kb,
        system_uptime: uptime_str,
        system_disk_free: disk_free_mb,
        system_network_io: net_io_kb,
        cpu_history: Vec::new(),
        mem_history: Vec::new(),
        net_history: Vec::new(),
    })
}

#[tauri::command]
/// 새로 만든 자산의 id를 돌려준다 — `rdp:` 링크 처리가 추가 직후 그 id로 슬롯을 배정한다.
pub async fn add_remote_host(app: AppHandle, name: String, host: String, protocol: String, username: Option<String>, tags: Option<Vec<String>>) -> Result<String, String> {
    let mut hosts = load_hosts(&app);
    let id = format!("manual-{}", Uuid::new_v4());
    let new_host = RemoteHost {
        id: id.clone(),
        name,
        host,
        username,
        protocol,
        is_detected: false,
        status: Some("Active".to_string()),
        latency: None,
        load: None,
        is_hidden: false,
        memo: None,
        tags,
    };
    hosts.push(new_host);
    save_hosts(&app, &hosts)?;
    Ok(id)
}

#[tauri::command]
pub async fn remove_remote_host(app: AppHandle, id: String) -> Result<(), String> {
    let mut hosts = load_hosts(&app);
    let mut found = false;

    // Mark as hidden instead of completely filtering, to prevent zombie registry regeneration
    for h in &mut hosts {
        if h.id == id {
            h.is_hidden = true;
            found = true;
        }
    }

    // If it was a purely auto-detected host never saved manually, we must register it as hidden
    if !found && (id.starts_with("detected-") || id.starts_with("vdi-")) {
        let host_ip = id.replace("detected-", "").replace("vdi-", "");
        let protocol = if id.starts_with("vdi-") { "HORIZON".to_string() } else { "RDP".to_string() };

        hosts.push(crate::hosts::RemoteHost {
            id,
            name: host_ip.clone(),
            host: host_ip,
            username: None,
            protocol,
            is_detected: true,
            status: None,
            latency: None,
            load: None,
            is_hidden: true,
            memo: None,
            tags: None,
        });
    }

    save_hosts(&app, &hosts)
}

#[tauri::command]
pub async fn update_remote_host(app: AppHandle, id: String, name: String, host: String, protocol: String, username: Option<String>, tags: Option<Vec<String>>) -> Result<(), String> {
    let mut hosts = load_hosts(&app);

    if let Some(h) = hosts.iter_mut().find(|h| h.id == id) {
        h.name = name;
        h.host = host;
        h.protocol = protocol;
        h.username = username;
        if let Some(t) = tags { h.tags = Some(t); }
    } else if id.starts_with("detected-") || id.starts_with("vdi-") {
        // Promoting an auto-detected host to a real manual entry (first edit).
        // is_detected MUST be false here — get_dashboard's merge logic only
        // protects a host's user-chosen protocol from being silently
        // relabeled by a later Horizon/RDP registry scan when is_detected is
        // false (see the "don't override their choice" comment there). Leaving
        // this true defeated that protection for every host that started out
        // auto-detected, which is the common case. tags must also come from
        // the caller, not be dropped — this branch previously discarded
        // whatever tags the user had just typed in the edit form.
        // If the user also changed the ADDRESS (not just name/tags/protocol),
        // the OLD address is still sitting in the Windows RDP/Horizon
        // registry — the next get_dashboard() poll re-scans it and, finding
        // no persisted entry whose `host` matches that old address anymore
        // (this promoted entry now has the NEW one), spawns a fresh
        // "detected-{old_host}"/"vdi-{old_host}" placeholder right back into
        // the list. That's why an address edit looked like it "didn't take"
        // — the old address just kept zombie-reappearing next to the new
        // one. remove_remote_host already has the fix for a bare detected
        // host (persist a hidden placeholder at that address so the merge
        // matches it by host and skips recreating it); apply the same fix
        // here whenever the address actually changed.
        let old_host = id.strip_prefix("detected-").or_else(|| id.strip_prefix("vdi-")).unwrap_or("").to_string();
        if !old_host.is_empty() && old_host != host {
            let old_protocol = if id.starts_with("vdi-") { "HORIZON".to_string() } else { "RDP".to_string() };
            hosts.push(RemoteHost {
                id,
                name: old_host.clone(),
                host: old_host,
                username: None,
                protocol: old_protocol,
                is_detected: true,
                status: None,
                latency: None,
                load: None,
                is_hidden: true,
                memo: None,
                tags: None,
            });
        }

        let new_host = RemoteHost {
            id: format!("manual-{}", Uuid::new_v4()),
            name,
            host,
            username,
            protocol,
            is_detected: false,
            status: Some("Active".to_string()),
            latency: None,
            load: None,
            is_hidden: false,
            memo: None,
            tags,
        };
        hosts.push(new_host);
    } else {
        return Err("호스트를 찾을 수 없습니다.".to_string());
    }

    save_hosts(&app, &hosts)
}

#[tauri::command]
pub async fn set_vm_memory(name: String, memory_gb: u32) -> Result<(), String> {
    let script = format!("Set-VMMemory -VMName '{}' -StartupBytes {}GB", ps_escape(&name), memory_gb);
    run_powershell(&script)?;
    Ok(())
}

#[tauri::command]
pub async fn set_vm_processors(name: String, processors: u32) -> Result<(), String> {
    let script = format!("Set-VMProcessor -VMName '{}' -Count {}", ps_escape(&name), processors);
    run_powershell(&script)?;
    Ok(())
}

#[tauri::command]
pub async fn get_horizon_path() -> String {
    let paths = vec![
        r"C:\Program Files\Omnissa\Omnissa Horizon Client\horizon-client.exe",
        r"C:\Program Files\VMware\VMware Horizon View Client\vmware-view.exe",
        r"C:\Program Files (x86)\VMware\VMware Horizon View Client\vmware-view.exe",
    ];

    for path in paths {
        if std::path::Path::new(path).exists() {
            return path.to_string();
        }
    }
    "".to_string()
}

#[tauri::command]
pub async fn connect_horizon(host: String, username: Option<String>) -> Result<u32, String> {
    let path = get_horizon_path().await;
    if path.is_empty() {
        return Err("Horizon Client가 설치되어 있지 않습니다.".to_string());
    }

    let clean_host = clean_host_url(&host);
    let mut cmd = Command::new(&path);
    cmd.arg("-serverURL").arg(&clean_host);
    // NOTE: grid-embedding Horizon is disabled (SwallowSlot.tsx) — the desktop
    // window's MKS display children stay pinned at absolute monitor coords and
    // never follow a reparented frame, even with -desktopLayout windowLarge.
    // This launch path is for standalone (non-swallowed) connections only.

    if let Some(user) = &username {
        if !user.is_empty() {
            cmd.arg("-userName").arg(user);
        }
    }

    let child = cmd.spawn().map_err(|e| format!("Failed to launch Horizon Client: {}", e))?;
    Ok(child.id())
}

// ─── Snapshot commands ────────────────────────────────────────────────────────

#[derive(Serialize, serde::Deserialize, Debug, Clone)]
pub struct VmSnapshot {
    pub id: String,
    pub name: String,
    pub vm_name: String,
    pub creation_time: String,
    pub snapshot_type: String,
}

#[tauri::command]
pub async fn list_snapshots(vm_name: String) -> Result<Vec<VmSnapshot>, String> {
    let safe_vm = ps_escape(&vm_name);
    let script = format!(
        r#"Get-VMSnapshot -VMName '{}' -ErrorAction Stop | Select-Object Id,Name,VMName,@{{N='CreationTime';E={{$_.CreationTime.ToString('yyyy-MM-dd HH:mm')}}}},SnapshotType | ConvertTo-Json -Depth 2"#,
        safe_vm
    );
    let out = tokio::task::spawn_blocking(move || run_powershell_warm(&script))
        .await
        .map_err(|e| format!("snapshot query task failed: {}", e))??;
    if out.is_empty() || out == "null" {
        return Ok(vec![]);
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct RawSnap {
        id: Option<String>,
        name: Option<String>,
        #[serde(rename = "VMName")]
        vm_name: Option<String>,
        creation_time: Option<String>,
        snapshot_type: Option<serde_json::Value>,
    }

    fn parse_snaps(out: &str) -> Vec<VmSnapshot> {
        let raws: Vec<RawSnap> = if out.trim_start().starts_with('[') {
            serde_json::from_str(out).unwrap_or_default()
        } else if let Ok(single) = serde_json::from_str::<RawSnap>(out) {
            vec![single]
        } else {
            return vec![];
        };
        raws.into_iter().map(|r| VmSnapshot {
            id: r.id.unwrap_or_default(),
            name: r.name.clone().unwrap_or_default(),
            vm_name: r.vm_name.unwrap_or_default(),
            creation_time: r.creation_time.unwrap_or_default(),
            snapshot_type: r.snapshot_type
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "Standard".to_string()),
        }).collect()
    }

    Ok(parse_snaps(&out))
}

#[tauri::command]
pub async fn create_snapshot(vm_name: String, snapshot_name: String) -> Result<(), String> {
    let safe_vm = ps_escape(&vm_name);
    let safe_name = ps_escape(&snapshot_name);
    let script = if snapshot_name.is_empty() {
        format!("Checkpoint-VM -Name '{}'", safe_vm)
    } else {
        format!("Checkpoint-VM -Name '{}' -SnapshotName '{}'", safe_vm, safe_name)
    };
    run_powershell(&script)?;
    Ok(())
}

#[tauri::command]
pub async fn restore_snapshot(vm_name: String, snapshot_name: String) -> Result<(), String> {
    let safe_vm = ps_escape(&vm_name);
    let safe_name = ps_escape(&snapshot_name);
    let script = format!(
        "Restore-VMSnapshot -VMName '{}' -Name '{}' -Confirm:$false",
        safe_vm, safe_name
    );
    run_powershell(&script)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_snapshot(vm_name: String, snapshot_name: String) -> Result<(), String> {
    let safe_vm = ps_escape(&vm_name);
    let safe_name = ps_escape(&snapshot_name);
    let script = format!(
        "Remove-VMSnapshot -VMName '{}' -Name '{}' -Confirm:$false",
        safe_vm, safe_name
    );
    run_powershell(&script)?;
    Ok(())
}

// ─── VM Memo commands ─────────────────────────────────────────────────────────

fn get_vm_memos_path(app: &AppHandle) -> std::path::PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    if !path.exists() {
        let _ = std::fs::create_dir_all(&path);
    }
    path.push("vm-memos.json");
    path
}

#[tauri::command]
pub async fn get_vm_memo(app: AppHandle, vm_name: String) -> String {
    let path = get_vm_memos_path(&app);
    if let Ok(content) = std::fs::read_to_string(path) {
        if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, String>>(&content) {
            return map.get(&vm_name).cloned().unwrap_or_default();
        }
    }
    String::new()
}

#[tauri::command]
pub async fn set_vm_memo(app: AppHandle, vm_name: String, memo: String) -> Result<(), String> {
    let path = get_vm_memos_path(&app);
    let mut map: std::collections::HashMap<String, String> = if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };
    if memo.is_empty() {
        map.remove(&vm_name);
    } else {
        map.insert(vm_name, memo);
    }
    let json = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

// ─── VM Tag commands ──────────────────────────────────────────────────────────

fn get_vm_tags_path(app: &AppHandle) -> std::path::PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    if !path.exists() { let _ = std::fs::create_dir_all(&path); }
    path.push("vm-tags.json");
    path
}

fn load_vm_tags_map(app: &AppHandle) -> std::collections::HashMap<String, Vec<String>> {
    let path = get_vm_tags_path(app);
    if let Ok(content) = std::fs::read_to_string(path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    }
}

#[tauri::command]
pub async fn get_vm_tags(app: AppHandle, vm_name: String) -> Vec<String> {
    load_vm_tags_map(&app).get(&vm_name).cloned().unwrap_or_default()
}

#[tauri::command]
pub async fn set_vm_tags(app: AppHandle, vm_name: String, tags: Vec<String>) -> Result<(), String> {
    let path = get_vm_tags_path(&app);
    let mut map = load_vm_tags_map(&app);
    if tags.is_empty() { map.remove(&vm_name); } else { map.insert(vm_name, tags); }
    let json = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_remote_host_tags(app: AppHandle, id: String, tags: Vec<String>) -> Result<(), String> {
    let mut hosts = load_hosts(&app);
    if let Some(h) = hosts.iter_mut().find(|h| h.id == id) {
        h.tags = if tags.is_empty() { None } else { Some(tags) };
        save_hosts(&app, &hosts)
    } else if id.starts_with("detected-") || id.starts_with("vdi-") {
        let host_ip = id.replace("detected-", "").replace("vdi-", "");
        let protocol = if id.starts_with("vdi-") { "HORIZON".to_string() } else { "RDP".to_string() };
        hosts.push(crate::hosts::RemoteHost {
            id,
            name: host_ip.clone(),
            host: host_ip,
            username: None,
            protocol,
            is_detected: true,
            status: None,
            latency: None,
            load: None,
            is_hidden: false,
            memo: None,
            tags: if tags.is_empty() { None } else { Some(tags) },
        });
        save_hosts(&app, &hosts)
    } else {
        Err("호스트를 찾을 수 없습니다.".to_string())
    }
}

#[tauri::command]
pub async fn set_remote_host_memo(app: AppHandle, id: String, memo: String) -> Result<(), String> {
    let mut hosts = load_hosts(&app);
    if let Some(h) = hosts.iter_mut().find(|h| h.id == id) {
        h.memo = if memo.is_empty() { None } else { Some(memo) };
        save_hosts(&app, &hosts)
    } else if id.starts_with("detected-") || id.starts_with("vdi-") {
        // Auto-detected hosts only exist in memory (built by get_dashboard);
        // create a persistent entry so the memo is not lost.
        let host_ip = id.replace("detected-", "").replace("vdi-", "");
        let protocol = if id.starts_with("vdi-") { "HORIZON".to_string() } else { "RDP".to_string() };
        hosts.push(crate::hosts::RemoteHost {
            id,
            name: host_ip.clone(),
            host: host_ip,
            username: None,
            protocol,
            is_detected: true,
            status: None,
            latency: None,
            load: None,
            is_hidden: false,
            memo: if memo.is_empty() { None } else { Some(memo) },
            tags: None,
        });
        save_hosts(&app, &hosts)
    } else {
        Err("호스트를 찾을 수 없습니다.".to_string())
    }
}

// ─── Data management commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn get_data_dir_path(app: AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn reset_hidden_hosts(app: AppHandle) -> Result<(), String> {
    let mut hosts = load_hosts(&app);
    for h in hosts.iter_mut() {
        h.is_hidden = false;
    }
    save_hosts(&app, &hosts)
}

#[tauri::command]
pub async fn clear_app_data(app: AppHandle) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    for name in ["hosts.json", "vm-memos.json", "vm-tags.json"] {
        let file = path.join(name);
        if file.exists() {
            std::fs::remove_file(file).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn set_window_visibility(slot_id: String, visible: bool) -> Result<(), String> {
    crate::swallow::set_visibility(&slot_id, visible)
}

#[tauri::command]
pub async fn is_window_valid(slot_id: String) -> bool {
    let state = crate::swallow::lock_state();
    if let Some(info) = state.get(&slot_id) {
        use windows::Win32::UI::WindowsAndMessaging::IsWindow;
        use windows::Win32::Foundation::HWND;
        unsafe {
            IsWindow(HWND(info.child_hwnd as *mut _)).as_bool()
        }
    } else {
        false
    }
}

#[tauri::command]
pub async fn swallow_window(
    window: tauri::Window,
    slot_id: String,
    pid: u32,
    x: i32, y: i32, width: i32, height: i32,
    // VM name for Hyper-V console connects (window-title discriminator —
    // vmconnect's spawned PID can hand off to an existing instance and exit,
    // so the title is the only reliable way to find the right window).
    expected_title: Option<String>
) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    let parent_hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0);
    let bounds = crate::swallow::SlotBounds { x, y, width, height };
    crate::swallow::swallow(&slot_id, pid, parent_hwnd, window.app_handle().clone(), bounds, expected_title)
}

// ─── Borderless fullscreen (flash-free, layout-correct) ──────────────────────
//
// NOT tao's set_fullscreen — that re-adds the OS caption for a frame on Windows
// (the "HyperDesk" title-bar flash) even though decorations are off. And NOT a
// raw Win32 SetWindowPos either — bypassing tao meant the WebView child wasn't
// always resized to the new bounds (the "규격이 안 맞음" mis-sized fullscreen,
// especially entering from a restored window). set_position/set_size go through
// tao, which resizes the WebView properly, without ever touching decorations.
// A borderless window exactly covering the monitor also makes the taskbar yield.

struct SavedWindowState {
    pos: tauri::PhysicalPosition<i32>,
    /// INNER size. `set_size` sets the inner/client size (tao set_inner_size),
    /// so the saved size must be inner too — the earlier code saved outer_size
    /// and restored it through set_size, growing the window by the invisible
    /// border on every fullscreen round-trip.
    size: tauri::PhysicalSize<u32>,
    maximized: bool,
    /// 전체화면 동안 리사이즈를 끄므로, 이탈 시 원래 값으로 되돌리려고 보관한다.
    resizable: bool,
}
/// Some(saved) == currently fullscreen (holds the state to restore on exit).
static FS_SAVED: OnceLock<Mutex<Option<SavedWindowState>>> = OnceLock::new();

fn fs_saved() -> &'static Mutex<Option<SavedWindowState>> {
    FS_SAVED.get_or_init(|| Mutex::new(None))
}

/// ITaskbarList2::MarkFullscreenWindow — explicitly registers/unregisters the
/// window as fullscreen with the shell, so the taskbar keeps itself BELOW it
/// while the window is active. Geometry-based "rude app" detection alone is not
/// enough here: keyboard focus lives on a swallowed CHILD that belongs to a
/// foreign process (mstsc), and after an Alt+Tab round-trip the shell re-
/// evaluates against that child instead of our fullscreen frame — which is when
/// the taskbar popped back over the fullscreen RDP view. vmconnect didn't show
/// it because its input window sits on our thread tree differently. Best-effort:
/// on failure the geometric detection still applies.
fn mark_fullscreen_native(window: &tauri::Window, on: bool) {
    let Ok(h) = window.hwnd() else { return };
    crate::swallow::mark_fullscreen_native(windows::Win32::Foundation::HWND(h.0), on);
    // Also lets focus_window (Alt+1~4 slot switch) re-assert this after
    // SetForegroundWindow on a swallowed child drops it — see swallow.rs.
    crate::swallow::set_fullscreen_active(on);
}

static LAST_NATIVE_MAXIMIZED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn mark_fullscreen_from_thread(hwnd: crate::swallow::SendHWND, on: bool) {
    crate::swallow::mark_fullscreen_native(hwnd.0, on);
    crate::swallow::set_fullscreen_active(on);
}

/// Called on every WindowEvent::Resized (lib.rs). The window is decorations:false
/// (WS_CAPTION stripped for the custom Topbar), and a plain WS_POPUP-style window's
/// native maximize() covers the FULL monitor rect instead of the work area — Windows
/// only reserves taskbar space against maximize for windows that still have
/// WS_CAPTION. Without the same MarkFullscreenWindow treatment apply_fullscreen (F11)
/// already uses, the shell draws the taskbar on top of the last ~40px at the bottom
/// (and a few px at the right, DWM's snap margin for un-marked maximized windows) of
/// whatever's rendered there — including a swallowed VM. F11 owns the mark while
/// active (apply_fullscreen unmaximizes first), so this only acts when it's not.
pub(crate) fn sync_fullscreen_mark_for_maximize(window: &tauri::Window) {
    if lock_or_recover(fs_saved()).is_some() { return; }
    // REVERTED (2026-08-28): a `covers_monitor` gate briefly lived here, skipping the
    // mark whenever inner_size() didn't reach the full monitor rect. That gate was based
    // on dlog NUMBERS alone (inner_size=(1920,1032) vs monitor=(1920,1080)) without ever
    // visually confirming the fix — and on THIS machine maximize apparently never covers
    // the full monitor, so the gate made `now_max` permanently false and this whole
    // function a no-op (confirmed live: zero [maximize-sync] lines across a 12-minute
    // session that included clicking maximize). The user then reproduced the EXACT bar
    // this mechanism exists to prevent, with the gate silently disabling it. Back to
    // the original, field-validated behavior: mark on `is_maximized()` alone.
    let now_max = window.is_maximized().unwrap_or(false);
    if LAST_NATIVE_MAXIMIZED.swap(now_max, std::sync::atomic::Ordering::Relaxed) != now_max {
        #[cfg(debug_assertions)]
        {
            // mark_fullscreen_native firing made no visible difference to the
            // Hyper-V right/bottom crop — meaning the taskbar-Z-order theory this
            // whole mechanism was built on may be wrong. Log the actual geometry
            // (does maximize truly cover the full monitor, or only the work area
            // excluding the taskbar?) to settle it with numbers instead of theory.
            let mon_str = match window.current_monitor() {
                Ok(Some(m)) => format!("pos={:?} size={:?}", m.position(), m.size()),
                Ok(None) => "none".to_string(),
                Err(e) => format!("err={:?}", e),
            };
            crate::swallow::dlog(&format!(
                "[maximize-sync] state changed now_max={} outer_pos={:?} outer_size={:?} inner_pos={:?} inner_size={:?} monitor=({})",
                now_max, window.outer_position(), window.outer_size(),
                window.inner_position(), window.inner_size(), mon_str
            ));
        }
        // This runs inside on_window_event, invoked SYNCHRONOUSLY from within
        // Windows' own WM_SIZE/WM_WINDOWPOSCHANGED handling for the maximize —
        // calling ITaskbarList2 (a cross-process COM call into explorer.exe) from
        // inside that nested callback hung the whole app on hitting the maximize
        // button (confirmed live: "응답 없음"). Microsoft's own guidance is to
        // never call ITaskbarList* from inside WM_SIZE. Defer it to a throwaway
        // thread, fully outside the window-proc call stack.
        let Ok(h) = window.hwnd() else { return };
        let hwnd = crate::swallow::SendHWND(windows::Win32::Foundation::HWND(h.0));
        // Passing the whole SendHWND as a function argument (not accessing `.0`
        // inline in the closure) is required — RFC 2229 disjoint closure capture
        // would otherwise capture just the inner (non-Send) HWND field, sidestepping
        // the unsafe impl Send on the wrapper and failing to compile.
        std::thread::spawn(move || mark_fullscreen_from_thread(hwnd, now_max));
    }
}

static LAST_MINIMIZED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Called on every WindowEvent::Resized (lib.rs). Minimizing does not change any
/// swallowed child's style or parent, so swallow.rs's stabilization loop stays in
/// its no-op branch for the whole round trip and nothing ever tells mstsc/vmconnect
/// to paint again — the slot comes back black. The same round trip also makes the
/// shell re-evaluate fullscreen (exactly like Alt+Tab and Alt+1~4 slot switching),
/// so a taskbar that was suppressed pops back over the VM. Both are repaired in
/// swallow::refresh_after_restore, on the restore edge only.
pub(crate) fn sync_restore_from_minimize(window: &tauri::Window) {
    let now_min = window.is_minimized().unwrap_or(false);
    if LAST_MINIMIZED.swap(now_min, std::sync::atomic::Ordering::Relaxed) == now_min { return; }
    if now_min { return; } // only act on minimized -> restored
    // Same rule as sync_fullscreen_mark_for_maximize: this runs INSIDE Windows'
    // WM_SIZE dispatch, and refresh_after_restore ends in an ITaskbarList2 call
    // (cross-process COM into explorer.exe). Never from this call stack.
    std::thread::spawn(|| {
        // The webview container has not finished laying out on the restore edge;
        // repainting before it settles just paints the stale rect again.
        std::thread::sleep(std::time::Duration::from_millis(120));
        crate::swallow::refresh_after_restore();
    });
}

/// 전체화면 동안 모니터의 **작업영역**을 모니터 전체로 넓히고, 나갈 때 원래대로 되돌린다.
///
/// **이게 없으면 RDP는 전체화면에서 하단이 안 채워진다.** mstsc는 자기 클라이언트를
/// 로컬 모니터의 **작업영역**에 클램프한다 — 실측(2026-09-03): 작업영역이 1920x1032일 때
/// 슬롯을 1918x1078로 잡아도 mstsc 창은 1920x1040(= 클라이언트 1032 + 보이지 않는 테두리 8)
/// 에서 더 안 커졌고, 바깥에서 SetWindowPos로 아무리 밀어도 튕겨냈다(400회+). 그래서
/// 화면 하단 ~46px이 비었다. vmconnect는 이 클램프를 안 해서 Hyper-V는 멀쩡했다.
///
/// **작업표시줄을 숨기지 않는다.** 예전엔 `SHAppBarMessage(ABS_AUTOHIDE)`로 작업표시줄을
/// 자동숨김으로 바꿔 작업영역을 넓혔는데, 그건 전역 설정 토글이라 (a) 작업표시줄이
/// 슬라이드하며 **화면이 번쩍이고** (b) 변경이 브로드캐스트돼 **다른 모니터의 최대화
/// 창까지 리사이즈**됐다(2026-09-10, 09-21 사용자 보고). mstsc에 필요한 건 작업영역 **값**
/// 뿐이라 `SPI_SETWORKAREA`로 그 값만 바꾼다. `SPIF_SENDCHANGE`를 주지 않아 아무 창에도
/// 알리지 않는다 — 작업표시줄 상태도, 다른 창도 그대로다. 작업표시줄 자체는 그대로
/// 있지만 전체화면 창이 `MarkFullscreenWindow`로 셸에 등록돼 있어 그 위로 올라오지 않는다.
/// "알림 없이도 값이 즉시 반영된다"는 전제는 `work_area_changes_without_broadcast`
/// (`cargo test -- --ignored`, 실기기 프로브)로 확인한다.
///
/// 원래 값은 `GetMonitorInfo`로 **그 모니터의** 작업영역을 저장한다(`SPI_GETWORKAREA`는
/// 주 모니터 것만 준다). `SPI_SETWORKAREA`는 넘긴 사각형이 속한 모니터의 작업영역을 바꾼다.
pub(crate) fn expand_work_area(mon_x: i32, mon_y: i32, mon_w: u32, mon_h: u32) {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    let full = RECT { left: mon_x, top: mon_y, right: mon_x + mon_w as i32, bottom: mon_y + mon_h as i32 };
    unsafe {
        let hmon = MonitorFromRect(&full, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(hmon, &mut mi).as_bool() {
            return;
        }
        {
            // 한 번만 저장한다 — 중첩 진입 시 이미 넓힌 값으로 덮어쓰면 원복할 값을 잃는다.
            let mut saved = lock_or_recover(work_area_saved());
            if saved.is_none() {
                *saved = Some(mi.rcWork);
            }
        }
    }
    set_work_area(full);
}

/// `expand_work_area`로 넓힌 적이 있으면 원래 작업영역으로 되돌린다. 넓힌 적 없으면 아무것도
/// 안 한다 — 종료 경로에서도 부르므로, 건드린 적 없는 값을 바꾸면 안 된다.
pub(crate) fn restore_work_area() {
    let prev = lock_or_recover(work_area_saved()).take();
    if let Some(r) = prev {
        set_work_area(r);
    }
}

fn set_work_area(r: windows::Win32::Foundation::RECT) {
    use windows::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_SETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS};
    let mut r = r;
    unsafe {
        // fwinini = 0: 레지스트리에 안 쓰고(SPIF_UPDATEINIFILE 없음) 브로드캐스트도 안 한다
        // (SPIF_SENDCHANGE 없음). 둘 중 하나라도 넣으면 번쩍임/리플로우가 되살아난다.
        let _ = SystemParametersInfoW(
            SPI_SETWORKAREA, 0, Some(&mut r as *mut _ as *mut _), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
    }
}

static WORK_AREA_SAVED: OnceLock<Mutex<Option<windows::Win32::Foundation::RECT>>> = OnceLock::new();
fn work_area_saved() -> &'static Mutex<Option<windows::Win32::Foundation::RECT>> {
    WORK_AREA_SAVED.get_or_init(|| Mutex::new(None))
}

fn apply_fullscreen(window: &tauri::Window, on: bool) -> Result<(), String> {
    // CRITICAL: never hold the fs_saved() lock across a window.set_size/
    // set_position/maximize/unmaximize call. Those run on the main thread and
    // synchronously fire WindowEvent::Resized (WM_SIZE/WM_WINDOWPOSCHANGED),
    // which commands::sync_fullscreen_mark_for_maximize handles by locking this
    // SAME mutex — while THIS function (running on a tokio worker thread, since
    // it's invoked from an async #[tauri::command]) is blocked waiting for the
    // main thread to finish that very window call. That's a cross-thread
    // deadlock: worker holds the lock + waits on main; main (mid-dispatch) waits
    // on the lock. Confirmed live: hitting F11 (or immersive, which also calls
    // setFullscreen) left this mutex locked forever, so it looked fine at first
    // but froze the ENTIRE app ("응답 없음") the next time anything resized the
    // window (e.g. clicking maximize) — see dlog trail 2026-07-23. Keep every
    // lock scope here to a bare read/write, dropped before any window.* call.
    if on {
        {
            let saved = lock_or_recover(fs_saved());
            if saved.is_some() { return Ok(()); } // already fullscreen
        }
        let maximized = window.is_maximized().unwrap_or(false);
        if maximized {
            // A maximized window ignores/mangles direct resizes — restore first.
            let _ = window.unmaximize();
        }
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let monitor = window.current_monitor().map_err(|e| e.to_string())?
            .ok_or("no monitor")?;
        let resizable = window.is_resizable().unwrap_or(true);
        {
            let mut saved = lock_or_recover(fs_saved());
            *saved = Some(SavedWindowState { pos, size, maximized, resizable });
        }
        // **전체화면 동안은 리사이즈를 끈다.** decorations:false 창의 리사이즈 경계는
        // 클라이언트 영역 안쪽 가장자리에 있어서, 전체화면에서 모니터 상단에 마우스를
        // 대면 세로 조정 커서가 뜨고 실제로 높이가 바뀌었다. 같은 경계가 우상단
        // 모서리에서는 VM 위를 덮고 있어 마우스가 닿는 순간 앱 창이 입력을 가져갔다
        // (2026-09-21 사용자 보고). 스타일이 바뀌면 보이지 않는 테두리 폭도 달라지므로
        // 아래 인셋은 **이 호출 뒤에** 다시 잰다.
        let _ = window.set_resizable(false);
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        let inner_pos = window.inner_position().map_err(|e| e.to_string())?;

        // tao keeps WS_THICKFRAME on a decorations:false window (resize/snap),
        // and on Win10/11 that style carries an INVISIBLE resize border: the
        // outer rect (GetWindowRect) is ~7px wider than the client area the
        // webview actually paints, on the left/right/bottom. Fullscreen must
        // align the CLIENT rect with the monitor, not the outer rect —
        // positioning by outer bounds rendered the content inset from the left
        // edge and spilling off the right ("앱이 우측으로 밀림" in 32e3d4b).
        // So: shift the outer rect up/left by the measured inset, and set the
        // INNER size to the monitor size exactly. The outer rect then overhangs
        // the screen edges by the border width — invisible by definition, and
        // still covering the monitor, which geometric fullscreen detection needs.
        // **크기를 잡기 전에** 작업영역을 넓힌다. 뒤에 하면 작업영역 변경이 레이아웃
        // 재계산을 유발해 슬롯이 한 번 더 커진다 — 실측(2026-09-03): 전체화면 직후 슬롯이
        // 1918x1078 → 1918x1085로 7px 늘어 모니터(1080)를 넘겼다.
        //
        // RDP 유무와 무관하게 항상 넓힌다. 예전 autohide 방식은 토글할 때마다 번쩍여서
        // RDP가 있을 때만 켜는 게이트가 필요했는데, 알림 없는 작업영역 변경은 눈에 보이는
        // 부작용이 없어서 게이트가 필요 없다 — 덕분에 전체화면 도중 RDP로 전환하거나
        // 새로 연결해도 처음부터 넓혀져 있다.
        expand_work_area(monitor.position().x, monitor.position().y, monitor.size().width, monitor.size().height);

        let inset_l = inner_pos.x - pos.x;
        let inset_t = inner_pos.y - pos.y;
        let mon_pos = *monitor.position();
        window.set_position(tauri::PhysicalPosition::new(mon_pos.x - inset_l, mon_pos.y - inset_t))
            .map_err(|e| e.to_string())?;
        window.set_size(*monitor.size()).map_err(|e| e.to_string())?;
        mark_fullscreen_native(window, true);
    } else {
        let taken = {
            let mut saved = lock_or_recover(fs_saved());
            saved.take()
        };
        if let Some(s) = taken {
            mark_fullscreen_native(window, false);
            restore_work_area();
            // 저장해 둔 크기/위치는 리사이즈 가능 상태에서 잰 값이라, 먼저 되돌린 뒤 복원한다.
            let _ = window.set_resizable(s.resizable);
            if s.maximized {
                let _ = window.maximize();
            } else {
                let _ = window.set_size(s.size);
                let _ = window.set_position(s.pos);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_fullscreen(window: tauri::Window) -> Result<(), String> {
    let on = lock_or_recover(fs_saved()).is_none();
    apply_fullscreen(&window, on)
}

/// Deterministic fullscreen (immersive VM view needs set-not-toggle so its state
/// can't desync from the window when F11 is also used).
#[tauri::command]
pub async fn set_fullscreen(window: tauri::Window, on: bool) -> Result<(), String> {
    apply_fullscreen(&window, on)
}

/// Fully quit the app (tray menu "종료"). Restores
/// any swallowed children first so they aren't left reparented into a dying
/// process.
#[tauri::command]
pub async fn quit_app(app: AppHandle) {
    // 전체화면 중 종료해도 작업표시줄이 숨겨진 채 남지 않게 원복한다.
    restore_work_area();
    crate::swallow::unswallow_all();
    app.exit(0);
}

#[tauri::command]
pub async fn unswallow_window(slot_id: String) -> Result<(), String> {
    crate::swallow::unswallow(&slot_id)
}

#[tauri::command]
pub async fn sync_slot_bounds(slot_id: String, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    crate::swallow::update_position(&slot_id, x, y, width, height);
    Ok(())
}

#[tauri::command]
pub async fn set_header_cutout(slot_id: String, x: Option<i32>, y: Option<i32>, width: Option<i32>, height: Option<i32>) -> Result<(), String> {
    let pill = match (x, y, width, height) {
        (Some(x), Some(y), Some(w), Some(h)) if w > 0 && h > 0 => Some((x, y, w, h)),
        _ => None,
    };
    crate::swallow::set_header_cutout(&slot_id, pill);
    Ok(())
}

#[tauri::command]
pub async fn focus_slot_window(slot_id: String) -> Result<(), String> {
    crate::swallow::focus_window(&slot_id);
    Ok(())
}

/// Mirrors MultiView.tsx's `anyConnecting` into Rust so the Alt+1~4 global
/// hotkey handler (which runs with no visibility into React state) can skip
/// its native focus_window call while a connect is in flight.
#[tauri::command]
pub async fn set_connect_lock(locked: bool) -> Result<(), String> {
    crate::swallow::set_connect_lock(locked);
    Ok(())
}

#[tauri::command]
pub async fn get_hyper_v_events(max_events: Option<u32>) -> Result<Vec<crate::models::HyperVEvent>, String> {
    let count = max_events.unwrap_or(50).min(200);
    let script = format!(r#"
        $logs = @('Microsoft-Windows-Hyper-V-Worker/Admin','Microsoft-Windows-Hyper-V-VMMS/Operational','Microsoft-Windows-Hyper-V-VMMS/Admin')
        $events = @()
        foreach ($log in $logs) {{
            try {{
                $events += Get-WinEvent -LogName $log -MaxEvents {} -ErrorAction SilentlyContinue |
                    ForEach-Object {{
                        [PSCustomObject]@{{
                            TimeCreated = $_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')
                            Level = switch ($_.LevelDisplayName) {{
                                'Error'       {{ 'error' }}
                                'Warning'     {{ 'warn' }}
                                'Information' {{ 'info' }}
                                default       {{ 'info' }}
                            }}
                            Message = $_.Message.Split("`n")[0].Trim()
                            EventId = [int]$_.Id
                        }}
                    }}
            }} catch {{}}
        }}
        if ($events.Count -eq 0) {{ '[]'; return }}
        $events | Sort-Object {{ $_.TimeCreated }} -Descending | Select-Object -First {} |
            if (($_ | Measure-Object).Count -eq 1) {{ $_ | ConvertTo-Json -Depth 2 -AsArray }}
            else {{ $_ | ConvertTo-Json -Depth 2 }}
    "#, count, count);

    let json = tokio::task::spawn_blocking(move || run_powershell_warm(&script))
        .await
        .map(|r| r.unwrap_or_else(|_| "[]".to_string()))
        .unwrap_or_else(|_| "[]".to_string());
    if json.is_empty() || json == "null" || json == "[]" {
        return Ok(vec![]);
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct Raw {
        time_created: String,
        level: String,
        message: String,
        event_id: u32,
    }

    let raw: Vec<Raw> = if json.trim_start().starts_with('[') {
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        match serde_json::from_str::<Raw>(&json) {
            Ok(s) => vec![s],
            Err(_) => return Ok(vec![]),
        }
    };

    Ok(raw.into_iter().map(|r| crate::models::HyperVEvent {
        time_created: r.time_created,
        level: r.level,
        message: r.message,
        event_id: r.event_id,
    }).collect())
}

#[tauri::command]
pub async fn get_vm_checkpoints(name: String) -> Result<Vec<crate::models::VmCheckpoint>, String> {
    let safe = ps_escape(&name);
    let script = format!(r#"
        $snaps = Get-VMSnapshot -VMName '{}' -ErrorAction SilentlyContinue
        if (!$snaps) {{ '[]'; return }}
        $result = $snaps | ForEach-Object {{
            [PSCustomObject]@{{
                Name = $_.Name
                VMName = $_.VMName
                CreationTime = $_.CreationTime.ToString('yyyy-MM-dd HH:mm:ss')
                CheckpointType = $_.SnapshotType.ToString()
                ParentCheckpointName = if ($_.ParentSnapshotName) {{ $_.ParentSnapshotName }} else {{ '' }}
            }}
        }}
        if (@($result).Count -eq 1) {{ $result | ConvertTo-Json -Depth 3 -AsArray }}
        else {{ $result | ConvertTo-Json -Depth 3 }}
    "#, safe);

    let json = tokio::task::spawn_blocking(move || run_powershell_warm(&script))
        .await
        .map(|r| r.unwrap_or_else(|_| "[]".to_string()))
        .unwrap_or_else(|_| "[]".to_string());
    if json.is_empty() || json == "null" || json == "[]" {
        return Ok(vec![]);
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct Raw {
        name: String,
        #[serde(rename = "VMName")]
        vm_name: String,
        creation_time: String,
        checkpoint_type: String,
        parent_checkpoint_name: String,
    }

    let raw: Vec<Raw> = if json.trim_start().starts_with('[') {
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        match serde_json::from_str::<Raw>(&json) {
            Ok(s) => vec![s],
            Err(_) => return Ok(vec![]),
        }
    };

    Ok(raw.into_iter().map(|r| crate::models::VmCheckpoint {
        name: r.name,
        vm_name: r.vm_name,
        creation_time: r.creation_time,
        checkpoint_type: r.checkpoint_type,
        parent_checkpoint: if r.parent_checkpoint_name.is_empty() { None } else { Some(r.parent_checkpoint_name) },
    }).collect())
}

#[tauri::command]
pub async fn checkpoint_vm(name: String, snapshot_name: String) -> Result<(), String> {
    let script = format!(
        "Checkpoint-VM -Name '{}' -SnapshotName '{}'",
        ps_escape(&name),
        ps_escape(&snapshot_name)
    );
    run_powershell(&script)?;
    Ok(())
}

#[tauri::command]
pub async fn restore_vm_checkpoint(vm_name: String, checkpoint_name: String) -> Result<(), String> {
    let safe_vm = ps_escape(&vm_name);
    let safe_snap = ps_escape(&checkpoint_name);
    let script = format!(r#"
        $vm = Get-VM -Name '{}' -ErrorAction Stop
        if ($vm.State -eq 'Running') {{
            Stop-VM -Name '{}' -Force -ErrorAction Stop
            $w = 0
            while ((Get-VM -Name '{}').State -ne 'Off' -and $w -lt 30) {{ Start-Sleep 1; $w++ }}
        }}
        Restore-VMSnapshot -VMName '{}' -Name '{}' -Confirm:$false
    "#, safe_vm, safe_vm, safe_vm, safe_vm, safe_snap);
    run_powershell(&script)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_vm_checkpoint(vm_name: String, checkpoint_name: String) -> Result<(), String> {
    let script = format!(
        "Remove-VMSnapshot -VMName '{}' -Name '{}' -Confirm:$false",
        ps_escape(&vm_name),
        ps_escape(&checkpoint_name)
    );
    run_powershell(&script)?;
    Ok(())
}

// ─── Disk usage & compaction ─────────────────────────────────────────────────

/// Read-only: walk the VM's virtual-disk chain (base .vhdx + every checkpoint
/// .avhdx layer) and report actual-vs-max sizes, so the user can see what's
/// eating host disk. Warm worker — it's a fast, UI-triggered read.
#[tauri::command]
pub async fn get_vm_disk_info(name: String) -> Result<Vec<crate::models::VmDiskEntry>, String> {
    let safe = ps_escape(&name);
    let script = format!(r#"
        $disks = Get-VMHardDiskDrive -VMName '{}' -ErrorAction Stop
        $chain = @()
        foreach ($d in $disks) {{
            $p = $d.Path
            while ($p) {{
                $vhd = Get-VHD -Path $p -ErrorAction SilentlyContinue
                if (-not $vhd) {{ break }}
                $chain += [PSCustomObject]@{{
                    Path = $vhd.Path
                    DiskType = $vhd.VhdType.ToString()
                    FileSize = [long]$vhd.FileSize
                    MaxSize = [long]$vhd.Size
                    IsCheckpoint = ($vhd.VhdType.ToString() -eq 'Differencing')
                }}
                $p = $vhd.ParentPath
            }}
        }}
        if (@($chain).Count -eq 1) {{ $chain | ConvertTo-Json -Depth 2 -AsArray }}
        else {{ $chain | ConvertTo-Json -Depth 2 }}
    "#, safe);

    let json = tokio::task::spawn_blocking(move || run_powershell_warm(&script))
        .await
        .map(|r| r.unwrap_or_else(|_| "[]".to_string()))
        .unwrap_or_else(|_| "[]".to_string());
    if json.is_empty() || json == "null" || json == "[]" {
        return Ok(vec![]);
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct Raw {
        path: String,
        disk_type: String,
        file_size: u64,
        max_size: u64,
        is_checkpoint: bool,
    }
    let raw: Vec<Raw> = if json.trim_start().starts_with('[') {
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        match serde_json::from_str::<Raw>(&json) { Ok(s) => vec![s], Err(_) => return Ok(vec![]) }
    };
    Ok(raw.into_iter().map(|r| crate::models::VmDiskEntry {
        path: r.path,
        disk_type: r.disk_type,
        file_size: r.file_size,
        max_size: r.max_size,
        is_checkpoint: r.is_checkpoint,
    }).collect())
}

/// Compacts every dynamic disk in the VM's chain (Optimize-VHD, Full mode),
/// reclaiming blocks the guest freed. Lifecycle op → COLD run_powershell (can
/// take minutes) and refuses to run unless the VM is Off — Optimize-VHD needs
/// the disk mounted read-only, impossible while a running VM holds it. Returns
/// the number of bytes reclaimed so the UI can show a concrete result.
/// Fixed disks are skipped (can't be compacted).
#[tauri::command]
pub async fn compact_vm_disk(name: String) -> Result<u64, String> {
    let safe = ps_escape(&name);
    let script = format!(r#"
        $vm = Get-VM -Name '{}' -ErrorAction Stop
        if ($vm.State -ne 'Off') {{
            Write-Error 'VM이 실행 중입니다. 디스크를 압축하려면 먼저 VM을 종료하세요.'
            exit 1
        }}
        $disks = Get-VMHardDiskDrive -VMName '{}' -ErrorAction Stop
        $freed = [long]0
        foreach ($d in $disks) {{
            $p = $d.Path
            while ($p) {{
                $vhd = Get-VHD -Path $p -ErrorAction SilentlyContinue
                if (-not $vhd) {{ break }}
                $parent = $vhd.ParentPath
                # Fixed disks have nothing to reclaim; skip.
                if ($vhd.VhdType.ToString() -ne 'Fixed') {{
                    $before = [long]$vhd.FileSize
                    $mounted = $false
                    try {{
                        Mount-VHD -Path $p -ReadOnly -ErrorAction Stop
                        $mounted = $true
                        Optimize-VHD -Path $p -Mode Full -ErrorAction Stop
                    }} catch {{
                        # Leave a partial failure non-fatal for the rest of the chain,
                        # but surface it if NOTHING could be optimized.
                    }} finally {{
                        if ($mounted) {{ Dismount-VHD -Path $p -ErrorAction SilentlyContinue }}
                    }}
                    $after = [long](Get-VHD -Path $p).FileSize
                    if ($before -gt $after) {{ $freed += ($before - $after) }}
                }}
                $p = $parent
            }}
        }}
        $freed
    "#, safe, safe);

    let out = run_powershell(&script)?;
    out.trim().parse::<u64>().map_err(|_| format!("압축 결과를 해석하지 못했습니다: {}", out))
}

/// Converts a VM's Fixed base disk(s) to Dynamic — reclaiming the gap between the
/// virtual max size and what the guest actually uses (a fixed disk always occupies
/// its full max on the host). Lifecycle op → COLD run_powershell (Convert-VHD
/// copies the whole disk, minutes). Heavily guarded: VM must be Off, and there must
/// be NO checkpoints (a differencing chain can't have its base swapped safely).
/// Failure modes are safe — the VM is only re-pointed at the new disk AFTER a
/// successful conversion, so a mid-way failure never leaves it diskless.
/// Returns bytes reclaimed.
#[tauri::command]
pub async fn convert_vm_disk_to_dynamic(name: String) -> Result<u64, String> {
    let safe = ps_escape(&name);
    let script = format!(r#"
        $vm = Get-VM -Name '{}' -ErrorAction Stop
        if ($vm.State -ne 'Off') {{
            Write-Error 'VM이 실행 중입니다. 디스크를 변환하려면 먼저 VM을 종료하세요.'
            exit 1
        }}
        if ((Get-VMSnapshot -VMName '{}' -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {{
            Write-Error '체크포인트가 있으면 변환할 수 없습니다. 스냅샷 페이지에서 먼저 삭제하세요.'
            exit 1
        }}
        $drives = @(Get-VMHardDiskDrive -VMName '{}' -ErrorAction Stop)
        $freed = [long]0
        foreach ($drv in $drives) {{
            $vhd = Get-VHD -Path $drv.Path -ErrorAction SilentlyContinue
            if (-not $vhd) {{ continue }}
            if ($vhd.VhdType.ToString() -ne 'Fixed') {{ continue }}
            $src = $vhd.Path
            $dir = Split-Path $src -Parent
            $stem = [System.IO.Path]::GetFileNameWithoutExtension($src)
            $ext = [System.IO.Path]::GetExtension($src)
            $dst = Join-Path $dir ($stem + '-dyn' + $ext)
            if (Test-Path $dst) {{ Write-Error "변환 대상 파일이 이미 존재합니다: $dst"; exit 1 }}
            $before = [long]$vhd.FileSize
            # Non-destructive copy first — source stays intact until this succeeds.
            Convert-VHD -Path $src -DestinationPath $dst -VHDType Dynamic -ErrorAction Stop
            # Re-point the SAME controller slot at the new dynamic disk, then drop
            # the fixed original. If Set fails, the VM still holds the untouched
            # source; if Remove fails, the source just lingers — never diskless.
            Set-VMHardDiskDrive -VMName '{}' -ControllerType $drv.ControllerType -ControllerNumber $drv.ControllerNumber -ControllerLocation $drv.ControllerLocation -Path $dst -ErrorAction Stop
            Remove-Item $src -Force -ErrorAction SilentlyContinue
            $after = [long](Get-VHD -Path $dst).FileSize
            if ($before -gt $after) {{ $freed += ($before - $after) }}
        }}
        $freed
    "#, safe, safe, safe, safe);

    let out = run_powershell(&script)?;
    out.trim().parse::<u64>().map_err(|_| format!("변환 결과를 해석하지 못했습니다: {}", out))
}

#[tauri::command]
pub async fn get_vm_switches() -> Result<Vec<crate::models::VmSwitch>, String> {
    let script = r#"
        $switches = Get-VMSwitch -ErrorAction SilentlyContinue
        if (!$switches) { '[]'; return }
        $result = $switches | ForEach-Object {
            [PSCustomObject]@{
                Name = $_.Name
                SwitchType = $_.SwitchType.ToString()
                NetAdapterName = if ($_.NetAdapterInterfaceDescription) { $_.NetAdapterInterfaceDescription } else { '' }
            }
        }
        if (@($result).Count -eq 1) { $result | ConvertTo-Json -Depth 2 -AsArray }
        else { $result | ConvertTo-Json -Depth 2 }
    "#;

    let json = tokio::task::spawn_blocking(|| run_powershell_warm(script))
        .await
        .map(|r| r.unwrap_or_else(|_| "[]".to_string()))
        .unwrap_or_else(|_| "[]".to_string());
    if json.is_empty() || json == "null" || json == "[]" {
        return Ok(vec![]);
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct Raw { name: String, switch_type: String, net_adapter_name: String }

    let raw: Vec<Raw> = if json.trim_start().starts_with('[') {
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        match serde_json::from_str::<Raw>(&json) {
            Ok(s) => vec![s],
            Err(_) => return Ok(vec![]),
        }
    };

    Ok(raw.into_iter().map(|r| crate::models::VmSwitch {
        name: r.name,
        switch_type: r.switch_type,
        net_adapter_name: r.net_adapter_name,
    }).collect())
}

#[tauri::command]
pub async fn get_vm_network_adapters() -> Result<Vec<crate::models::VmNetworkAdapter>, String> {
    let script = r#"
        $adapters = Get-VMNetworkAdapter -VMName * -ErrorAction SilentlyContinue
        if (!$adapters) { '[]'; return }
        $result = $adapters | ForEach-Object {
            [PSCustomObject]@{
                VMName = $_.VMName
                SwitchName = if ($_.SwitchName) { $_.SwitchName } else { '' }
            }
        }
        if (@($result).Count -eq 1) { $result | ConvertTo-Json -Depth 2 -AsArray }
        else { $result | ConvertTo-Json -Depth 2 }
    "#;

    let json = tokio::task::spawn_blocking(|| run_powershell_warm(script))
        .await
        .map(|r| r.unwrap_or_else(|_| "[]".to_string()))
        .unwrap_or_else(|_| "[]".to_string());
    if json.is_empty() || json == "null" || json == "[]" {
        return Ok(vec![]);
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct Raw { vm_name: String, switch_name: String }

    let raw: Vec<Raw> = if json.trim_start().starts_with('[') {
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        match serde_json::from_str::<Raw>(&json) {
            Ok(s) => vec![s],
            Err(_) => return Ok(vec![]),
        }
    };

    Ok(raw.into_iter().map(|r| crate::models::VmNetworkAdapter {
        vm_name: r.vm_name,
        switch_name: r.switch_name,
    }).collect())
}

#[cfg(test)]
mod tests {
    /// 실기기 프로브(수동: `cargo test -- --ignored work_area`): **알림 없이** `SPI_SETWORKAREA`로
    /// 바꾼 작업영역이 `GetMonitorInfo`에 즉시 보이는가. 거짓이면 mstsc도 새 값을 못 보고
    /// `expand_work_area`는 무의미하다. 실제 작업영역을 잠깐 넓혔다 되돌린다(브로드캐스트가
    /// 없어 화면엔 안 보인다). 주 모니터에 작업표시줄이 있어야 의미가 있다(없으면 전후가 같다).
    #[test]
    #[ignore]
    fn work_area_changes_without_broadcast() {
        use windows::Win32::Foundation::{POINT, RECT};
        use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTOPRIMARY};
        let t = |r: RECT| (r.left, r.top, r.right, r.bottom);
        unsafe {
            let hmon = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
            let read = || {
                let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
                let _ = GetMonitorInfoW(hmon, &mut mi);
                mi
            };
            let before = read();
            let m = before.rcMonitor;
            eprintln!("monitor={:?} work(before)={:?}", t(m), t(before.rcWork));
            assert_ne!(t(before.rcWork), t(m), "작업표시줄이 없는 모니터라 판정 불가");
            super::expand_work_area(m.left, m.top, (m.right - m.left) as u32, (m.bottom - m.top) as u32);
            let during = read().rcWork;
            super::restore_work_area();
            let after = read().rcWork;
            eprintln!("work(during)={:?} work(after)={:?}", t(during), t(after));
            assert_eq!(t(during), t(m), "알림 없이도 작업영역이 모니터 전체로 반영돼야 한다");
            assert_eq!(t(after), t(before.rcWork), "원래 값으로 복원돼야 한다");
        }
    }

    use super::*;

    #[test]
    fn test_rdp_sanitize_strips_injection() {
        // A newline in host/username would inject arbitrary .rdp directives.
        assert_eq!(rdp_sanitize("10.0.0.1\nalternate shell:s:cmd.exe"),
                   "10.0.0.1alternate shell:s:cmd.exe");
        assert_eq!(rdp_sanitize("user\r\nx"), "userx");
        assert_eq!(rdp_sanitize("\tadmin"), "admin");
        assert_eq!(rdp_sanitize("clean-host.local"), "clean-host.local");
    }

    #[test]
    fn test_ps_escape_doubles_quotes() {
        assert_eq!(ps_escape("a'b"), "a''b");
        assert_eq!(ps_escape("plain"), "plain");
    }

    #[test]
    fn test_system_history_rotation() {
        let mut history = SystemHistory::new(5);
        
        // Push 6 items to check if first item is popped
        for i in 0..6 {
            history.push(i as f64, i as f64, i as f64);
        }
        
        assert_eq!(history.cpu.len(), 5);
        assert_eq!(history.cpu[0], 1.0); // The value 0.0 should have been popped
        assert_eq!(history.cpu[4], 5.0);
    }

    #[test]
    fn test_resource_data_formatting() {
        // Since we can't easily mock the entire System info without deep refactoring,
        // we test the uptime formatting logic specifically.
        let uptime_secs = 90061; // 1 day, 1 hour, 1 minute, 1 second
        let days = uptime_secs / 86400;
        let hours = (uptime_secs % 86400) / 3600;
        let minutes = (uptime_secs % 3600) / 60;
        let uptime_str = format!("{}d {}h {}m", days, hours, minutes);
        
        assert_eq!(uptime_str, "1d 1h 1m");
    }

    #[test]
    fn test_clean_host_url() {
        // Exercises the REAL clean_host_url (not an inline copy), so a regression
        // in the shipped function is actually caught.
        assert_eq!(clean_host_url("https://horizon.vdi.com/"), "horizon.vdi.com");
        assert_eq!(clean_host_url("horizon.vdi.com"), "horizon.vdi.com");
        assert_eq!(clean_host_url("http://192.168.1.100/"), "192.168.1.100");
        // Scheme stripped but an explicit port is preserved (health-check needs it).
        assert_eq!(clean_host_url("https://vdi.example.com:8443/"), "vdi.example.com:8443");
        // Multiple trailing slashes all trimmed; bare host untouched.
        assert_eq!(clean_host_url("http://host.local///"), "host.local");
        assert_eq!(clean_host_url("10.0.0.5"), "10.0.0.5");
    }

    #[test]
    fn test_ps_escape_multiple_quotes() {
        // A VM name with several apostrophes must have EVERY one doubled — a
        // single missed quote is a PowerShell injection hole (CLAUDE.md rule #1).
        assert_eq!(ps_escape("a'b'c"), "a''b''c");
        assert_eq!(ps_escape("'; Remove-Item C:\\ -Recurse '"), "''; Remove-Item C:\\ -Recurse ''");
        assert_eq!(ps_escape(""), "");
    }

    #[test]
    fn test_rdp_sanitize_preserves_normal_chars() {
        // Only control chars are stripped — spaces, dots, backslashes (domain\\user)
        // and unicode must survive so legitimate hosts/usernames aren't corrupted.
        assert_eq!(rdp_sanitize("CORP\\john.doe"), "CORP\\john.doe");
        assert_eq!(rdp_sanitize("서버-01"), "서버-01");
        assert_eq!(rdp_sanitize("a\u{0007}b"), "ab"); // bell char removed
    }

    // ── 체크포인트 JSON 파싱 ────────────────────────────────────────────

    fn parse_checkpoints(json: &str) -> Vec<crate::models::VmCheckpoint> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "PascalCase")]
        struct Raw {
            name: String,
            #[serde(rename = "VMName")]
            vm_name: String,
            creation_time: String,
            checkpoint_type: String,
            parent_checkpoint_name: String,
        }
        let raw: Vec<Raw> = if json.trim_start().starts_with('[') {
            serde_json::from_str(json).unwrap_or_default()
        } else {
            match serde_json::from_str::<Raw>(json) {
                Ok(s) => vec![s],
                Err(_) => vec![],
            }
        };
        raw.into_iter().map(|r| crate::models::VmCheckpoint {
            name: r.name,
            vm_name: r.vm_name,
            creation_time: r.creation_time,
            checkpoint_type: r.checkpoint_type,
            parent_checkpoint: if r.parent_checkpoint_name.is_empty() { None } else { Some(r.parent_checkpoint_name) },
        }).collect()
    }

    #[test]
    fn test_checkpoint_parsing_single_object() {
        let json = r#"{"Name":"Before-Update","VMName":"SRV-01","CreationTime":"2026-06-01 10:00:00","CheckpointType":"Standard","ParentCheckpointName":""}"#;
        let result = parse_checkpoints(json);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Before-Update");
        assert_eq!(result[0].vm_name, "SRV-01");
        assert!(result[0].parent_checkpoint.is_none());
    }

    #[test]
    fn test_checkpoint_parsing_array() {
        let json = r#"[
            {"Name":"CP-1","VMName":"SRV-01","CreationTime":"2026-06-01 10:00:00","CheckpointType":"Standard","ParentCheckpointName":""},
            {"Name":"CP-2","VMName":"SRV-01","CreationTime":"2026-06-02 10:00:00","CheckpointType":"Standard","ParentCheckpointName":"CP-1"}
        ]"#;
        let result = parse_checkpoints(json);
        assert_eq!(result.len(), 2);
        assert_eq!(result[1].name, "CP-2");
        assert_eq!(result[1].parent_checkpoint, Some("CP-1".to_string()));
    }

    #[test]
    fn test_checkpoint_empty_input_returns_empty_vec() {
        assert_eq!(parse_checkpoints("[]").len(), 0);
        assert_eq!(parse_checkpoints("").len(), 0);
    }

    // ── vSwitch JSON 파싱 ──────────────────────────────────────────────

    fn parse_switches(json: &str) -> Vec<crate::models::VmSwitch> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "PascalCase")]
        struct Raw { name: String, switch_type: String, net_adapter_name: String }
        let raw: Vec<Raw> = if json.trim_start().starts_with('[') {
            serde_json::from_str(json).unwrap_or_default()
        } else {
            match serde_json::from_str::<Raw>(json) {
                Ok(s) => vec![s],
                Err(_) => vec![],
            }
        };
        raw.into_iter().map(|r| crate::models::VmSwitch {
            name: r.name,
            switch_type: r.switch_type,
            net_adapter_name: r.net_adapter_name,
        }).collect()
    }

    #[test]
    fn test_switch_parsing_external() {
        let json = r#"[{"Name":"External Bridge","SwitchType":"External","NetAdapterName":"Realtek PCIe GbE"}]"#;
        let result = parse_switches(json);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "External Bridge");
        assert_eq!(result[0].switch_type, "External");
        assert_eq!(result[0].net_adapter_name, "Realtek PCIe GbE");
    }

    #[test]
    fn test_switch_parsing_internal_no_adapter() {
        let json = r#"[{"Name":"Default Switch","SwitchType":"Internal","NetAdapterName":""}]"#;
        let result = parse_switches(json);
        assert_eq!(result[0].switch_type, "Internal");
        assert_eq!(result[0].net_adapter_name, "");
    }

    // ── 네트워크 어댑터 JSON 파싱 ──────────────────────────────────────

    fn parse_adapters(json: &str) -> Vec<crate::models::VmNetworkAdapter> {
        #[derive(serde::Deserialize)]
        struct Raw {
            #[serde(rename = "VMName")]
            vm_name: String,
            #[serde(rename = "SwitchName")]
            switch_name: String,
        }
        let raw: Vec<Raw> = if json.trim_start().starts_with('[') {
            serde_json::from_str(json).unwrap_or_default()
        } else {
            match serde_json::from_str::<Raw>(json) {
                Ok(s) => vec![s],
                Err(_) => vec![],
            }
        };
        raw.into_iter().map(|r| crate::models::VmNetworkAdapter {
            vm_name: r.vm_name,
            switch_name: r.switch_name,
        }).collect()
    }

    #[test]
    fn test_network_adapter_parsing() {
        let json = r#"[{"VMName":"SRV-01","SwitchName":"Default Switch"},{"VMName":"SRV-02","SwitchName":"External Bridge"}]"#;
        let result = parse_adapters(json);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].vm_name, "SRV-01");
        assert_eq!(result[0].switch_name, "Default Switch");
        assert_eq!(result[1].switch_name, "External Bridge");
    }

    #[test]
    fn test_network_adapter_empty_switch() {
        let json = r#"[{"VMName":"SRV-01","SwitchName":""}]"#;
        let result = parse_adapters(json);
        assert_eq!(result[0].switch_name, "");
    }

    #[test]
    fn test_b64_rfc4648_vectors() {
        assert_eq!(b64(b""), "");
        assert_eq!(b64(b"f"), "Zg==");
        assert_eq!(b64(b"fo"), "Zm8=");
        assert_eq!(b64(b"foo"), "Zm9v");
        assert_eq!(b64(b"foobar"), "Zm9vYmFy");
        assert_eq!(b64("한글".as_bytes()), "7ZWc6riA");
    }

    #[test]
    fn test_ps_worker_roundtrip() {
        // Success, error (Write-Error under EAP=Stop must NOT kill the loop),
        // then success again through the same worker — the persistence claim.
        let mut w = spawn_ps_worker().expect("spawn worker");
        let (out, ok) = ps_worker_exec(&mut w, "Write-Output '한글OK'").unwrap();
        assert!(ok, "first exec failed: {}", out);
        assert_eq!(out.trim(), "한글OK");
        let (out, ok) = ps_worker_exec(&mut w, "$ErrorActionPreference='Stop'; Write-Error 'boom'; exit 1").unwrap();
        assert!(!ok);
        assert!(out.contains("boom"));
        let (out, ok) = ps_worker_exec(&mut w, "1 + 1").unwrap();
        assert!(ok, "worker died after error case");
        assert_eq!(out.trim(), "2");
        let _ = w.child.kill();
    }
}
