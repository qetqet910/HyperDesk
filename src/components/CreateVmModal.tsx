import { useState, useEffect } from "react";
import { X, Server, Loader2, HardDrive, Cpu, MemoryStick, Disc, Network } from "lucide-react";
import { api } from "@/lib/tauri-api";
import type { VmSwitch } from "@/types";

interface CreateVmModalProps {
  onClose: () => void;
  onCreated: (name: string) => void;
  onError: (msg: string) => void;
}

/** New-VM wizard: name + generation + memory/vCPU/disk + optional switch & boot
 *  ISO. Kept to the fields that actually matter to get a bootable VM; anything
 *  else is tunable afterward in VM settings / Hyper-V. */
export function CreateVmModal({ onClose, onCreated, onError }: CreateVmModalProps) {
  const [name, setName] = useState("");
  const [generation, setGeneration] = useState<1 | 2>(2);
  const [memoryGb, setMemoryGb] = useState(4);
  const [cpuCount, setCpuCount] = useState(2);
  const [diskGb, setDiskGb] = useState(60);
  const [switchName, setSwitchName] = useState<string>("");
  const [isoPath, setIsoPath] = useState("");
  const [switches, setSwitches] = useState<VmSwitch[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getVmSwitches().then(setSwitches).catch(() => setSwitches([]));
  }, []);

  const nameValid = /^[^\\/:*?"<>|]{1,64}$/.test(name.trim());
  const canSubmit = nameValid && memoryGb >= 1 && cpuCount >= 1 && diskGb >= 1 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await api.createVm({
        name: name.trim(),
        generation,
        memoryGb,
        cpuCount,
        diskGb,
        switchName: switchName || undefined,
        isoPath: isoPath.trim() || undefined,
      });
      onCreated(name.trim());
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const labelStyle: React.CSSProperties = { fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' };
  const inputStyle: React.CSSProperties = { width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--glass-border)', borderRadius: '10px', padding: '11px 14px', color: 'var(--text-main)', fontSize: '14px', fontWeight: 600, outline: 'none' };
  const cardStyle: React.CSSProperties = { background: 'rgba(0,0,0,0.2)', padding: '16px 18px', borderRadius: '14px', border: '1px solid var(--glass-border)' };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.7)', zIndex: 400 }}>
      <div className="modal-content glass-modal" onClick={(e) => e.stopPropagation()} style={{ width: '460px', maxHeight: '90vh', overflowY: 'auto', padding: 0, border: 'none' }}>
        <div style={{ height: '2px', width: '100%', background: 'linear-gradient(90deg, transparent, var(--neon-blue), transparent)' }} />
        <div className="modal-header" style={{ padding: '26px 24px 18px' }}>
          <div className="header-title">
            <div className="neon-text-blue" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Server size={20} />
              <h3 style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '-0.5px' }}>새 가상 머신 생성</h3>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Name */}
          <div style={cardStyle}>
            <div style={labelStyle}><Server size={12} /> 이름</div>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: WinServer-01" autoFocus />
            {name.length > 0 && !nameValid && <div style={{ fontSize: '10.5px', color: 'var(--accent-red)', marginTop: '6px' }}>{`\\ / : * ? " < > | 는 사용할 수 없습니다.`}</div>}
          </div>

          {/* Generation */}
          <div style={cardStyle}>
            <div style={labelStyle}>세대 (Generation)</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {([2, 1] as const).map((g) => (
                <button key={g} onClick={() => setGeneration(g)} style={{
                  flex: 1, padding: '10px', borderRadius: '10px', fontSize: '12px', fontWeight: 800, cursor: 'pointer',
                  background: generation === g ? 'var(--accent-blue)' : 'rgba(255,255,255,0.03)',
                  color: generation === g ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${generation === g ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
                }}>
                  Gen {g}{g === 2 ? ' (UEFI)' : ' (BIOS)'}
                </button>
              ))}
            </div>
          </div>

          {/* Memory / vCPU / Disk */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div style={cardStyle}>
              <div style={labelStyle}><MemoryStick size={12} /> RAM</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                <input type="number" min={1} max={512} style={{ ...inputStyle, padding: '8px 10px', fontFamily: 'var(--font-num)' }} value={memoryGb} onChange={(e) => setMemoryGb(Number(e.target.value))} />
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>GB</span>
              </div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}><Cpu size={12} /> vCPU</div>
              <input type="number" min={1} max={64} style={{ ...inputStyle, padding: '8px 10px', fontFamily: 'var(--font-num)' }} value={cpuCount} onChange={(e) => setCpuCount(Number(e.target.value))} />
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}><HardDrive size={12} /> 디스크</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                <input type="number" min={1} max={4096} style={{ ...inputStyle, padding: '8px 10px', fontFamily: 'var(--font-num)' }} value={diskGb} onChange={(e) => setDiskGb(Number(e.target.value))} />
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>GB</span>
              </div>
            </div>
          </div>

          {/* Switch */}
          <div style={cardStyle}>
            <div style={labelStyle}><Network size={12} /> 네트워크 스위치 (선택)</div>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={switchName} onChange={(e) => setSwitchName(e.target.value)}>
              <option value="">연결 안 함</option>
              {switches.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.switch_type})</option>)}
            </select>
          </div>

          {/* ISO */}
          <div style={cardStyle}>
            <div style={labelStyle}><Disc size={12} /> 부팅 ISO 경로 (선택)</div>
            <input style={inputStyle} value={isoPath} onChange={(e) => setIsoPath(e.target.value)} placeholder="예: C:\ISO\windows.iso" />
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px' }}>OS 설치 미디어를 DVD로 연결하고 부팅 순서를 맞춥니다.</div>
          </div>
        </div>

        <div className="modal-actions" style={{ padding: '20px 24px', background: 'rgba(0,0,0,0.2)', display: 'flex', gap: '12px' }}>
          <button onClick={onClose} style={{ flex: 1, height: '46px', borderRadius: '12px', background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', fontWeight: 700, cursor: 'pointer', fontSize: '14px' }}>취소</button>
          <button onClick={submit} disabled={!canSubmit} style={{
            flex: 2, height: '46px', borderRadius: '12px', border: 'none', color: '#fff', fontWeight: 800, fontSize: '14px',
            background: canSubmit ? 'linear-gradient(135deg, var(--neon-blue), #4f8ef7)' : 'rgba(255,255,255,0.05)',
            cursor: canSubmit ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          }}>
            {busy ? <><Loader2 size={16} className="spinning" /> 생성 중...</> : <><Server size={16} /> 가상 머신 생성</>}
          </button>
        </div>
      </div>
    </div>
  );
}
