import { useState, useEffect, useCallback } from "react";
import { X, Cpu, MemoryStick, AlertTriangle, Save, Square, HardDrive, Loader2, Camera } from "lucide-react";
import type { VmInfo, VmDiskEntry } from "@/types";
import { useVmActions } from "@/hooks/useDashboard";
import { ConfirmModal } from "@/components/ConfirmModal";
import { TagEditor } from "@/components/TagEditor";
import { api } from "@/lib/tauri-api";
import { useT } from "@/lib/i18n";

const fmtGB = (bytes: number) => {
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 10 ? gb.toFixed(0) : gb.toFixed(1);
};

/** Disk usage + compaction panel. Read-only info loads on mount; compaction is
 *  gated on the VM being Off (Optimize-VHD needs the disk mounted read-only). */
function DiskSection({ vm, isRunning, onLog }: { vm: VmInfo; isRunning: boolean; onLog?: (m: string, t: "info" | "success" | "error" | "warn") => void }) {
  const t = useT();
  const [disks, setDisks] = useState<VmDiskEntry[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [confirmCompact, setConfirmCompact] = useState(false);
  const [converting, setConverting] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadErr(null);
      setDisks(await api.getVmDiskInfo(vm.name));
    } catch (e) {
      setLoadErr(String(e));
    }
  }, [vm.name]);

  useEffect(() => { load(); }, [load]);

  const total = disks?.reduce((s, d) => s + d.file_size, 0) ?? 0;
  const hasDynamic = disks?.some(d => d.disk_type === "Dynamic") ?? false;
  const hasFixed = disks?.some(d => d.disk_type === "Fixed") ?? false;
  const hasCheckpoint = disks?.some(d => d.is_checkpoint) ?? false;
  const checkpointBytes = disks?.filter(d => d.is_checkpoint).reduce((s, d) => s + d.file_size, 0) ?? 0;

  const runCompact = async () => {
    setCompacting(true);
    onLog?.(t("vmset.log.compactStart", { name: vm.name }), "info");
    try {
      const freed = await api.compactVmDisk(vm.name);
      const gb = (freed / 1024 / 1024 / 1024).toFixed(1);
      onLog?.(t("vmset.log.compactDone", { gb }), "success");
      await load();
    } catch (e) {
      onLog?.(t("vmset.log.compactFail", { err: String(e) }), "error");
    } finally {
      setCompacting(false);
    }
  };

  const runConvert = async () => {
    setConverting(true);
    onLog?.(t("vmset.log.convertStart", { name: vm.name }), "info");
    try {
      const freed = await api.convertVmDiskToDynamic(vm.name);
      const gb = (freed / 1024 / 1024 / 1024).toFixed(1);
      onLog?.(t("vmset.log.convertDone", { gb }), "success");
      await load();
    } catch (e) {
      onLog?.(t("vmset.log.convertFail", { err: String(e) }), "error");
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="settings-card" style={{
      background: 'rgba(0,0,0,0.2)', padding: '14px', borderRadius: '10px',
      border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '14px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <HardDrive size={16} className="neon-text-blue" style={{ opacity: 0.8 }} />
          <label style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>{t("vmset.diskUsage")}</label>
        </div>
        {disks && <div style={{ fontSize: '13px', fontWeight: 900, fontFamily: 'var(--font-num)' }}>{fmtGB(total)}<span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '3px' }}>GB</span></div>}
      </div>

      {loadErr && <div style={{ fontSize: '11px', color: 'var(--accent-orange)' }}>{t("vmset.diskLoadFail")}</div>}
      {!disks && !loadErr && <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}><Loader2 size={12} className="spinning" /> {t("vmset.analyzing")}</div>}

      {disks && disks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {disks.map((d) => {
            const fname = d.path.split('\\').pop() ?? d.path;
            return (
              <div key={d.path} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                {d.is_checkpoint
                  ? <Camera size={11} style={{ color: 'var(--accent-orange)', flexShrink: 0 }} />
                  : <HardDrive size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }} title={d.path}>
                  {fname}
                </span>
                <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', flexShrink: 0 }}>
                  {d.is_checkpoint ? t("vmset.checkpoint") : d.disk_type}
                </span>
                <span style={{ fontFamily: 'var(--font-num)', fontWeight: 800, flexShrink: 0, minWidth: '54px', textAlign: 'right' }}>{fmtGB(d.file_size)} GB</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Honest guidance: the two levers, and why compaction may not help here. */}
      {disks && disks.length > 0 && (
        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', lineHeight: 1.6, borderTop: '1px solid var(--glass-border)', paddingTop: '12px' }}>
          {checkpointBytes > 0 && (
            <div>{t("vmset.hintCkptPre")}<b style={{ color: 'var(--accent-orange)' }}>{fmtGB(checkpointBytes)}GB</b>{t("vmset.hintCkptPost")}</div>
          )}
          {hasDynamic && (
            <div>{t("vmset.hintDynamic")}{isRunning ? t("vmset.hintDynamicOff") : ''}.</div>
          )}
          {hasFixed && (
            <div>{t("vmset.hintFixed")}{isRunning ? t("vmset.hintFixedOff") : ''}.</div>
          )}
        </div>
      )}

      {(hasDynamic || hasFixed) && (
        <div style={{ display: 'flex', gap: '8px' }}>
          {hasDynamic && (
            <button
              onClick={() => setConfirmCompact(true)}
              disabled={isRunning || compacting || converting}
              style={{
                flex: 1, padding: '10px', fontSize: '11.5px', fontWeight: 800,
                background: isRunning ? 'rgba(255,255,255,0.04)' : 'rgba(91,130,190,0.14)',
                border: '1px solid var(--glass-border)', borderRadius: '10px',
                color: isRunning ? 'var(--text-muted)' : 'var(--text-main)',
                cursor: isRunning || compacting ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
              }}
              title={isRunning ? t("vmset.stopFirst") : undefined}
            >
              {compacting ? <><Loader2 size={13} className="spinning" /> {t("vmset.compacting")}</> : <><HardDrive size={13} /> {t("vmset.compact")}</>}
            </button>
          )}
          {hasFixed && (
            <button
              onClick={() => setConfirmConvert(true)}
              disabled={isRunning || converting || compacting || hasCheckpoint}
              style={{
                flex: 1, padding: '10px', fontSize: '11.5px', fontWeight: 800,
                background: (isRunning || hasCheckpoint) ? 'rgba(255,255,255,0.04)' : 'rgba(217,164,65,0.14)',
                border: '1px solid var(--glass-border)', borderRadius: '10px',
                color: (isRunning || hasCheckpoint) ? 'var(--text-muted)' : 'var(--accent-orange)',
                cursor: isRunning || converting || hasCheckpoint ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
              }}
              title={hasCheckpoint ? t("vmset.deleteCkptFirst") : isRunning ? t("vmset.stopFirst") : undefined}
            >
              {converting ? <><Loader2 size={13} className="spinning" /> {t("vmset.converting")}</> : <><HardDrive size={13} /> {t("vmset.convert")}</>}
            </button>
          )}
        </div>
      )}

      {confirmCompact && (
        <ConfirmModal
          title={t("vmset.compactTitle")}
          message={t("vmset.compactBody", { name: vm.name })}
          confirmText={t("vmset.compactConfirm")}
          onConfirm={() => { setConfirmCompact(false); runCompact(); }}
          onClose={() => setConfirmCompact(false)}
        />
      )}

      {confirmConvert && (
        <ConfirmModal
          title={t("vmset.convertTitle")}
          message={t("vmset.convertBody", { name: vm.name })}
          confirmText={t("vmset.convertConfirm")}
          type="danger"
          onConfirm={() => { setConfirmConvert(false); runConvert(); }}
          onClose={() => setConfirmConvert(false)}
        />
      )}
    </div>
  );
}

interface VmSettingsModalProps {
  vm: VmInfo;
  onClose: () => void;
  onLog?: (msg: string, type: "info" | "success" | "error" | "warn") => void;
}

export function VmSettingsModal({ vm, onClose, onLog }: VmSettingsModalProps) {
  const t = useT();
  const { setMemory, setProcessors, start, stop } = useVmActions();
  const parseMemory = (raw: any): number => {
    const val = Number(raw);
    return isNaN(val) ? 0 : Math.round(val / 1024 / 1024 / 1024);
  };

  const [newMemory, setNewMemory] = useState<number>(parseMemory(vm.memory_startup));
  const [newProcessors, setNewProcessors] = useState<number>(vm.processor_count || 1);
  const [tags, setTags] = useState<string[]>(vm.tags ?? []);
  const [isBusy, setIsBusy] = useState(false);

  const isRunning = vm.state === "Running";

  const [showConfirmStop, setShowConfirmStop] = useState(false);

  const handleSave = async () => {
    if (isRunning) {
      onLog?.(t("vmset.log.runningNoChange"), "warn");
      return;
    }

    setIsBusy(true);
    try {
      const currentMemGb = parseMemory(vm.memory_startup);
      if (newMemory !== currentMemGb) {
        onLog?.(t("vmset.log.memory", { gb: newMemory }), "info");
        await setMemory.mutateAsync({ name: vm.name, memoryGb: newMemory });
      }
      
      if (newProcessors !== vm.processor_count) {
        onLog?.(t("vmset.log.cpu", { n: newProcessors }), "info");
        await setProcessors.mutateAsync({ name: vm.name, processors: newProcessors });
      }

      await api.setVmTags(vm.name, tags);
      onLog?.(t("vmset.log.saved", { name: vm.name }), "success");
      onClose();
    } catch (e) {
      onLog?.(t("vmset.log.saveFail", { err: String(e) }), "error");
    } finally {
      setIsBusy(false);
    }
  };

  const handlePowerAction = async (action: 'start' | 'stop') => {
    setIsBusy(true);
    try {
      if (action === 'start') {
        await start.mutateAsync(vm.name);
        onLog?.(t("vmset.log.starting", { name: vm.name }), "success");
      } else {
        await stop.mutateAsync(vm.name);
        onLog?.(t("vmset.log.stopping", { name: vm.name }), "info");
      }
    } catch (e) {
      onLog?.(t("vmset.log.powerFail", { err: String(e) }), "error");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <>
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.7)', zIndex: 400 }}>
      <div className="modal-content glass-modal vm-settings-modal" onClick={(e) => e.stopPropagation()} style={{ width: '420px', padding: 0, overflow: 'hidden', border: 'none' }}>
        {/* Decorative Neon Header Line */}
        <div style={{ height: '2px', width: '100%', background: 'linear-gradient(90deg, transparent, var(--neon-blue), transparent)' }} />
        
        <div className="modal-header" style={{ padding: '18px 20px 14px', marginBottom: 0 }}>
          <div className="header-title">
            <div className="neon-text-blue" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Cpu size={20} />
              <h3 style={{ fontSize: '16px', fontWeight: 900, letterSpacing: '-0.5px' }}>{vm.name === 'DefaultVM' ? t("vmset.titleDefault") : t("vmset.title", { name: vm.name })}</h3>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
            <X size={18} />
          </button>
        </div>

        <div className="settings-body" style={{ padding: '0 20px 18px' }}>
          {isRunning && (
            <div style={{ 
              background: 'rgba(251, 191, 36, 0.05)', 
              border: '1px solid rgba(251, 191, 36, 0.2)', 
              borderRadius: '12px', 
              padding: '12px', 
              marginBottom: '24px',
              display: 'flex',
              gap: '14px'
            }}>
              <AlertTriangle size={20} style={{ color: '#fbbf24', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#fbbf24', marginBottom: '4px' }}>{t("vmset.runningTitle")}</div>
                <div style={{ fontSize: '11px', color: 'rgba(251, 191, 36, 0.7)', lineHeight: '1.6' }}>
                  {t("vmset.runningBody")}
                </div>
                <button 
                  onClick={() => setShowConfirmStop(true)}
                  disabled={isBusy}
                  style={{ 
                    marginTop: '12px', 
                    padding: '8px 14px', 
                    fontSize: '11px', 
                    background: 'rgba(239, 68, 68, 0.12)', 
                    border: '1px solid rgba(239, 68, 68, 0.25)', 
                    borderRadius: '8px',
                    color: '#f87171',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: 800,
                    transition: 'all 0.2s'
                  }}
                >
                  <Square size={12} fill="currentColor" /> {t("vmset.forceStop")}
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="settings-card" style={{ 
              background: 'rgba(0,0,0,0.2)', padding: '14px', borderRadius: '10px',
              border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Cpu size={16} className="neon-text-blue" style={{ opacity: 0.8 }} />
                  <label style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>vCPU Cores</label>
                </div>
                <div className="neon-text-blue" style={{ fontSize: '16px', fontWeight: 900 }}>{newProcessors}<span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '4px', color: '#fff' }}>VCPU</span></div>
              </div>
              <input 
                type="range" 
                min="1" 
                max="32" 
                value={newProcessors} 
                onChange={(e) => setNewProcessors(Number(e.target.value))}
                disabled={isRunning || isBusy}
                style={{ width: '100%', height: '5px', accentColor: 'var(--neon-blue)', cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.4 : 1 }}
              />
            </div>

            <div className="settings-card" style={{ 
              background: 'rgba(0,0,0,0.2)', padding: '14px', borderRadius: '10px',
              border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MemoryStick size={16} className="neon-text-blue" style={{ opacity: 0.8 }} />
                  <label style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Startup Ram</label>
                </div>
                <div className="neon-text-blue" style={{ fontSize: '16px', fontWeight: 900 }}>{newMemory}<span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '4px', color: '#fff' }}>GB</span></div>
              </div>
              <div style={{ position: 'relative' }}>
                <input 
                  type="number" 
                  min="1" 
                  max="128" 
                  value={newMemory} 
                  onChange={(e) => setNewMemory(Number(e.target.value))}
                  disabled={isRunning || isBusy}
                  style={{ 
                    width: '100%', 
                    background: 'rgba(0,0,0,0.2)', 
                    border: '1px solid var(--glass-border)', 
                    borderRadius: '10px', 
                    padding: '12px 16px',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 700,
                    outline: 'none',
                    transition: 'all 0.2s',
                    opacity: isRunning ? 0.5 : 1
                  }}
                />
              </div>
            </div>
          </div>

          {/* Disk usage & cleanup */}
          <div style={{ marginTop: '20px' }}>
            <DiskSection vm={vm} isRunning={isRunning} onLog={onLog} />
          </div>

          {/* Tags */}
          <div style={{ marginTop: '12px', background: 'rgba(0,0,0,0.2)', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--glass-border)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '10px' }}>{t("vmset.tags")}</div>
            <TagEditor tags={tags} onChange={setTags} />
          </div>
        </div>

        <div className="modal-actions" style={{ padding: '16px 20px', background: 'rgba(0,0,0,0.2)', display: 'flex', gap: '12px' }}>
          <button 
            className="cancel-btn" 
            onClick={onClose} 
            style={{ 
              flex: 1, 
              height: '38px', 
              borderRadius: '12px', 
              background: 'transparent', 
              border: '1px solid var(--glass-border)', 
              color: 'var(--text-secondary)', 
              fontWeight: 700, 
              cursor: 'pointer',
              fontSize: '13px',
              transition: 'all 0.2s'
            }}
          >
            {t("common.cancel")}
          </button>
          <button 
            className="confirm-btn" 
            onClick={handleSave}
            disabled={isRunning || isBusy}
            style={{ 
              flex: 2, 
              height: '38px', 
              borderRadius: '12px', 
              background: isRunning ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, var(--neon-blue), #4f8ef7)', 
              color: '#fff', 
              border: 'none', 
              cursor: isRunning ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              fontWeight: 800,
              fontSize: '13px',
              boxShadow: isRunning ? 'none' : '0 6px 20px rgba(0, 210, 255, 0.3)',
              transition: 'all 0.2s'
            }}
          >
            <Save size={18} /> {t("vmset.apply")}
          </button>
        </div>
      </div>
    </div>

    {showConfirmStop && (
      <ConfirmModal 
        title={t("vmset.forceStopTitle")}
        message={t("vmset.forceStopBody", { name: vm.name })}
        confirmText={t("vmset.forceStopConfirm")}
        type="danger"
        onConfirm={() => handlePowerAction('stop')}
        onClose={() => setShowConfirmStop(false)}
      />
    )}
    </>
  );
}
