import { X, Globe, User, Terminal, Save, Check, Wifi, WifiOff, Loader, AlertCircle } from "lucide-react";
import { useState, useRef } from "react";
import { api } from "@/lib/tauri-api";
import { TagEditor } from "@/components/TagEditor";

interface NewHost {
  id: string;
  name: string;
  host: string;
  username?: string;
  protocol: 'RDP' | 'HORIZON';
  is_detected: boolean;
  is_hidden: boolean;
  tags?: string[];
}

interface AssetModalProps {
  initialData?: NewHost;
  isEditing?: boolean;
  isPending?: boolean;
  onClose: () => void;
  onSubmit: (host: NewHost) => void;
}

type VerifyState = 'idle' | 'checking' | 'ok' | 'fail';

export function AssetModal({ initialData, isEditing = false, isPending = false, onClose, onSubmit }: AssetModalProps) {
  const [hostData, setHostData] = useState<NewHost>(
    initialData || {
      id: "",
      name: "",
      host: "",
      username: "",
      protocol: 'RDP',
      is_detected: false,
      is_hidden: false,
    }
  );
  const [tags, setTags] = useState<string[]>(initialData?.tags ?? []);
  const [verifyState, setVerifyState] = useState<VerifyState>('idle');
  const [verifyLatency, setVerifyLatency] = useState<number | null>(null);
  // Custom (non-native) validation so the field-required hint matches the app theme
  // instead of the browser's default "이 입력란을 작성하세요" bubble.
  const [errors, setErrors] = useState<{ name?: string; host?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const hostRef = useRef<HTMLInputElement>(null);

  const handleVerify = async () => {
    if (!hostData.host) return;
    setVerifyState('checking');
    setVerifyLatency(null);
    try {
      const latency = await api.checkHost(hostData.host, hostData.protocol);
      if (latency !== null && latency !== undefined) {
        setVerifyLatency(latency);
        setVerifyState('ok');
      } else {
        setVerifyState('fail');
      }
    } catch {
      setVerifyState('fail');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: { name?: string; host?: string } = {};
    if (!hostData.name.trim()) nextErrors.name = "자산 별칭을 입력하세요.";
    if (!hostData.host.trim()) nextErrors.host = "접속 엔드포인트를 입력하세요.";
    setErrors(nextErrors);
    if (nextErrors.name) { nameRef.current?.focus(); return; }
    if (nextErrors.host) { hostRef.current?.focus(); return; }
    onSubmit({ ...hostData, tags });
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.7)', zIndex: 500 }}>
      <div className="modal-content glass-modal asset-modal" onClick={(e) => e.stopPropagation()} style={{ width: '560px', maxWidth: '560px', padding: 0, overflow: 'hidden', border: 'none', display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}>
        {/* Decorative Neon Header Line */}
        <div style={{ height: '2px', width: '100%', background: 'linear-gradient(90deg, transparent, var(--neon-blue), transparent)' }} />

        <div className="modal-header" style={{ padding: '28px 24px 20px', border: 'none', marginBottom: 0 }}>
          <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="neon-text-blue" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Globe size={20} />
              <h3 style={{ fontSize: '19px', fontWeight: 900, letterSpacing: '-0.5px', textTransform: 'uppercase' }}>
                {isEditing ? '원격 자산 명세 수정' : '신규 원격 자산 등록'}
              </h3>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '0 24px 24px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Protocol Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Terminal size={12} /> 프로토콜 인터페이스
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setHostData({ ...hostData, protocol: 'RDP' })}
                  style={{ 
                    flex: 1, height: '42px', borderRadius: '10px', 
                    background: hostData.protocol === 'RDP' ? 'var(--accent-blue)' : 'rgba(255,255,255,0.03)', 
                    border: '1px solid var(--glass-border)', color: hostData.protocol === 'RDP' ? '#fff' : 'var(--text-muted)',
                    fontSize: '12px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s',
                    boxShadow: hostData.protocol === 'RDP' ? '0 0 15px rgba(79, 142, 247, 0.3)' : 'none'
                  }}
                >
                  {hostData.protocol === 'RDP' && <Check size={12} style={{ marginRight: '6px' }} />} MST (RDP)
                </button>
                <button
                  type="button"
                  onClick={() => setHostData({ ...hostData, protocol: 'HORIZON' })}
                  style={{ 
                    flex: 1, height: '42px', borderRadius: '10px', 
                    background: hostData.protocol === 'HORIZON' ? 'var(--accent-purple)' : 'rgba(255,255,255,0.03)', 
                    border: '1px solid var(--glass-border)', color: hostData.protocol === 'HORIZON' ? '#fff' : 'var(--text-muted)',
                    fontSize: '12px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s',
                    boxShadow: hostData.protocol === 'HORIZON' ? '0 0 15px rgba(168, 85, 247, 0.3)' : 'none'
                  }}
                >
                  {hostData.protocol === 'HORIZON' && <Check size={12} style={{ marginRight: '6px' }} />} OMNISSA (VDI)
                </button>
              </div>
            </div>

            {/* Asset Name */}
            <div className="settings-card" style={{ 
              background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '14px',
              border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '10px'
            }}>
              <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>자산 별칭 (Alias)</label>
              <input
                ref={nameRef}
                type="text"
                placeholder="예: IDC-STORAGE-01"
                value={hostData.name}
                onChange={(e) => { setHostData({ ...hostData, name: e.target.value }); if (errors.name) setErrors({ ...errors, name: undefined }); }}
                style={{
                  width: '100%', height: '42px', background: 'rgba(0,0,0,0.2)',
                  border: `1px solid ${errors.name ? 'var(--accent-red)' : 'var(--glass-border)'}`, borderRadius: '10px',
                  padding: '0 12px', color: '#fff', fontSize: '14px', outline: 'none', transition: 'border-color 0.15s'
                }}
              />
              {errors.name && (
                <span className="field-error"><AlertCircle size={12} /> {errors.name}</span>
              )}
            </div>

            {/* Connection Address */}
            <div className="settings-card" style={{ 
              background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '14px',
              border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '10px'
            }}>
              <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>접속 엔드포인트 (IP/FQDN)</label>
              <input
                ref={hostRef}
                type="text"
                placeholder="10.20.30.1 또는 horizon.vdi.com"
                value={hostData.host}
                onChange={(e) => { setHostData({ ...hostData, host: e.target.value }); setVerifyState('idle'); if (errors.host) setErrors({ ...errors, host: undefined }); }}
                style={{
                  width: '100%', height: '42px', background: 'rgba(0,0,0,0.2)',
                  border: `1px solid ${errors.host ? 'var(--accent-red)' : 'var(--glass-border)'}`, borderRadius: '10px',
                  padding: '0 12px', color: '#fff', fontSize: '14px', outline: 'none', transition: 'border-color 0.15s'
                }}
              />
              {errors.host && (
                <span className="field-error"><AlertCircle size={12} /> {errors.host}</span>
              )}
              {/* Verify button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
                <button
                  type="button"
                  disabled={!hostData.host || verifyState === 'checking'}
                  onClick={handleVerify}
                  style={{
                    height: '34px', padding: '0 14px', borderRadius: '8px', fontSize: '11px', fontWeight: 800,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)',
                    color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                    opacity: (!hostData.host || verifyState === 'checking') ? 0.4 : 1,
                  }}
                >
                  {verifyState === 'checking' ? <Loader size={12} className="spinning" /> :
                   verifyState === 'ok' ? <Wifi size={12} /> :
                   verifyState === 'fail' ? <WifiOff size={12} /> : <Wifi size={12} />}
                  연결 검증
                </button>
                {verifyState === 'ok' && (
                  <span style={{ fontSize: '11px', color: 'var(--accent-green)', fontWeight: 700 }}>
                    ✓ 응답 {verifyLatency}ms
                  </span>
                )}
                {verifyState === 'fail' && (
                  <span style={{ fontSize: '11px', color: 'var(--accent-red)', fontWeight: 700 }}>
                    ✗ 연결 실패 (TIMEOUT)
                  </span>
                )}
              </div>
            </div>

            {/* Credentials */}
            <div className="settings-card" style={{
              background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '14px',
              border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '12px'
            }}>
              {/* Username */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>사용자 계정</label>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({hostData.protocol === 'HORIZON' ? 'OMNISSA 로그인' : 'RDP 세션 전용'})</span>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder={hostData.protocol === 'HORIZON' ? 'domain\\username' : 'Administrator'}
                    value={hostData.username}
                    onChange={(e) => setHostData({ ...hostData, username: e.target.value })}
                    style={{
                      width: '100%', height: '42px', background: 'rgba(0,0,0,0.2)',
                      border: '1px solid var(--glass-border)', borderRadius: '10px',
                      padding: '0 40px 0 12px', color: '#fff', fontSize: '14px', outline: 'none'
                    }}
                  />
                  <User size={16} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', opacity: 0.3 }} />
                </div>
              </div>

            </div>

            {/* Tags */}
            <div className="settings-card" style={{
              background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '14px',
              border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '10px'
            }}>
              <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>태그</label>
              <TagEditor tags={tags} onChange={setTags} />
            </div>

            {/* NOTE: memo lives in its own MemoModal (notepad-style, opened from
                asset rows) — not buried here in the edit form. */}

            {/* Actions */}
            <div className="modal-actions" style={{ marginTop: '10px', display: 'flex', gap: '12px' }}>
              <button 
                type="button"
                className="cancel-btn" 
                onClick={onClose}
                disabled={isPending}
                style={{ 
                  flex: 1, height: '48px', borderRadius: '12px', background: 'transparent', 
                  border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', 
                  fontWeight: 700, cursor: 'pointer', fontSize: '15px'
                }}
              >
                취소
              </button>
              <button 
                type="submit" 
                className="confirm-btn" 
                disabled={isPending}
                style={{ 
                  flex: 2, height: '48px', borderRadius: '12px', 
                  background: 'linear-gradient(135deg, var(--accent-blue), #4f8ef7)', 
                  color: '#fff', border: 'none', fontWeight: 800, cursor: 'pointer', fontSize: '15px',
                  boxShadow: '0 6px 20px rgba(0, 210, 255, 0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px'
                }}
              >
                {isPending ? '최적화 중...' : (isEditing ? <Save size={18} /> : < Globe size={18} />)}
                {isPending ? '통신 중...' : (isEditing ? '수정 완료' : '자산 등록')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
