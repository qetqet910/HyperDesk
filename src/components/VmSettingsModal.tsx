import { useState } from "react";
import { X, Cpu, MemoryStick, AlertTriangle, Save, Square } from "lucide-react";
import type { VmInfo } from "@/types";
import { useVmActions } from "@/hooks/useDashboard";
import { ConfirmModal } from "@/components/ConfirmModal";
import { TagEditor } from "@/components/TagEditor";
import { api } from "@/lib/tauri-api";

interface VmSettingsModalProps {
  vm: VmInfo;
  onClose: () => void;
  onLog?: (msg: string, type: "info" | "success" | "error" | "warn") => void;
}

export function VmSettingsModal({ vm, onClose, onLog }: VmSettingsModalProps) {
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
      onLog?.("가동 중인 VM의 자원은 변경할 수 없습니다.", "warn");
      return;
    }

    setIsBusy(true);
    try {
      const currentMemGb = parseMemory(vm.memory_startup);
      if (newMemory !== currentMemGb) {
        onLog?.(`[VM] 메모리 최적화 시도: ${newMemory}GB`, "info");
        await setMemory.mutateAsync({ name: vm.name, memoryGb: newMemory });
      }
      
      if (newProcessors !== vm.processor_count) {
        onLog?.(`[VM] 프로세서 코어 조정: ${newProcessors} Cores`, "info");
        await setProcessors.mutateAsync({ name: vm.name, processors: newProcessors });
      }

      await api.setVmTags(vm.name, tags);
      onLog?.(`[SUCCESS] ${vm.name} 설정 저장 완료`, "success");
      onClose();
    } catch (e) {
      onLog?.(`[ERROR] 자원 할당 실패: ${e}`, "error");
    } finally {
      setIsBusy(false);
    }
  };

  const handlePowerAction = async (action: 'start' | 'stop') => {
    setIsBusy(true);
    try {
      if (action === 'start') {
        await start.mutateAsync(vm.name);
        onLog?.(`[VM] ${vm.name} 부팅 시퀀스 시작`, "success");
      } else {
        await stop.mutateAsync(vm.name);
        onLog?.(`[VM] ${vm.name} 시스템 종료 요청됨`, "info");
      }
    } catch (e) {
      onLog?.(`[ERROR] 전원 제어 실패: ${e}`, "error");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <>
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.7)', zIndex: 400 }}>
      <div className="modal-content glass-modal vm-settings-modal" onClick={(e) => e.stopPropagation()} style={{ width: '440px', padding: 0, overflow: 'hidden', border: 'none' }}>
        {/* Decorative Neon Header Line */}
        <div style={{ height: '2px', width: '100%', background: 'linear-gradient(90deg, transparent, var(--neon-blue), transparent)' }} />
        
        <div className="modal-header" style={{ padding: '28px 24px 20px', marginBottom: 0 }}>
          <div className="header-title">
            <div className="neon-text-blue" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Cpu size={20} />
              <h3 style={{ fontSize: '19px', fontWeight: 900, letterSpacing: '-0.5px' }}>{vm.name === 'DefaultVM' ? '리소스 임계치 조정' : `${vm.name} 자원 고도화`}</h3>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
            <X size={18} />
          </button>
        </div>

        <div className="settings-body" style={{ padding: '0 24px 24px' }}>
          {isRunning && (
            <div style={{ 
              background: 'rgba(251, 191, 36, 0.05)', 
              border: '1px solid rgba(251, 191, 36, 0.2)', 
              borderRadius: '12px', 
              padding: '16px', 
              marginBottom: '24px',
              display: 'flex',
              gap: '14px'
            }}>
              <AlertTriangle size={20} style={{ color: '#fbbf24', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#fbbf24', marginBottom: '4px' }}>실시간 자원 변경 제한됨</div>
                <div style={{ fontSize: '11px', color: 'rgba(251, 191, 36, 0.7)', lineHeight: '1.6' }}>
                  현재 VM이 가동 중입니다. 하드웨어 구성을 수정하려면 전원을 먼저 꺼야 합니다.
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
                  <Square size={12} fill="currentColor" /> 강제 시스템 종료
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="settings-card" style={{ 
              background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '14px',
              border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Cpu size={16} className="neon-text-blue" style={{ opacity: 0.8 }} />
                  <label style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>vCPU Cores</label>
                </div>
                <div className="neon-text-blue" style={{ fontSize: '19px', fontWeight: 900 }}>{newProcessors}<span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '4px', color: '#fff' }}>VCPU</span></div>
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
              background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '14px',
              border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MemoryStick size={16} className="neon-text-blue" style={{ opacity: 0.8 }} />
                  <label style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Startup Ram</label>
                </div>
                <div className="neon-text-blue" style={{ fontSize: '19px', fontWeight: 900 }}>{newMemory}<span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '4px', color: '#fff' }}>GB</span></div>
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
                    fontSize: '15px',
                    fontWeight: 700,
                    outline: 'none',
                    transition: 'all 0.2s',
                    opacity: isRunning ? 0.5 : 1
                  }}
                />
              </div>
            </div>
          </div>

          {/* Tags */}
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '18px 20px', borderRadius: '14px', border: '1px solid var(--glass-border)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '10px' }}>태그</div>
            <TagEditor tags={tags} onChange={setTags} />
          </div>
        </div>

        <div className="modal-actions" style={{ padding: '24px', background: 'rgba(0,0,0,0.2)', display: 'flex', gap: '12px' }}>
          <button 
            className="cancel-btn" 
            onClick={onClose} 
            style={{ 
              flex: 1, 
              height: '48px', 
              borderRadius: '12px', 
              background: 'transparent', 
              border: '1px solid var(--glass-border)', 
              color: 'var(--text-secondary)', 
              fontWeight: 700, 
              cursor: 'pointer',
              fontSize: '15px',
              transition: 'all 0.2s'
            }}
          >
            취소
          </button>
          <button 
            className="confirm-btn" 
            onClick={handleSave}
            disabled={isRunning || isBusy}
            style={{ 
              flex: 2, 
              height: '48px', 
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
              fontSize: '15px',
              boxShadow: isRunning ? 'none' : '0 6px 20px rgba(0, 210, 255, 0.3)',
              transition: 'all 0.2s'
            }}
          >
            <Save size={18} /> 적용 및 동기화
          </button>
        </div>
      </div>
    </div>

    {showConfirmStop && (
      <ConfirmModal 
        title="가상머신 강제 종료"
        message={`[${vm.name}]을(를) 강제로 종료하시겠습니까? 저장되지 않은 모든 데이터가 손실될 수 있습니다.`}
        confirmText="강제 종료 수행"
        type="danger"
        onConfirm={() => handlePowerAction('stop')}
        onClose={() => setShowConfirmStop(false)}
      />
    )}
    </>
  );
}
