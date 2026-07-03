import { X, AlertTriangle, Trash2, HelpCircle } from "lucide-react";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: "danger" | "warning" | "info";
  onConfirm: () => void;
  onClose: () => void;
  /** Optional third button (e.g. "완전 종료") shown between cancel and confirm. */
  extraText?: string;
  onExtra?: () => void;
}

export function ConfirmModal({
  title, message, confirmText = "확인", cancelText = "취소",
  type = "info", onConfirm, onClose, extraText, onExtra
}: ConfirmModalProps) {
  
  const getIcon = () => {
    switch (type) {
      case "danger": return <Trash2 size={24} style={{ color: 'var(--accent-red)' }} />;
      case "warning": return <AlertTriangle size={24} style={{ color: 'var(--accent-orange)' }} />;
      default: return <HelpCircle size={24} style={{ color: 'var(--accent-blue)' }} />;
    }
  };

  const getAccentColor = () => {
    switch (type) {
      case "danger": return 'var(--accent-red)';
      case "warning": return 'var(--accent-orange)';
      default: return 'var(--accent-blue)';
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.7)', zIndex: 1000 }}>
      <div className="modal-content glass-modal confirm-modal" onClick={(e) => e.stopPropagation()} style={{ width: '400px', padding: 0, overflow: 'hidden', border: 'none' }}>
        {/* Decorative Neon Header Line */}
        <div style={{ height: '2px', width: '100%', background: `linear-gradient(90deg, transparent, ${getAccentColor()}, transparent)` }} />

        <div className="modal-header" style={{ padding: '24px 24px 12px', border: 'none', marginBottom: 0 }}>
          <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)' }}>
              {getIcon()}
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 900, color: '#fff', letterSpacing: '-0.3px' }}>{title}</h3>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '0 24px 24px' }}>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.6', wordBreak: 'keep-all' }}>
            {message}
          </p>
        </div>

        <div className="modal-actions" style={{ padding: '20px 24px 24px', background: 'rgba(0,0,0,0.2)', display: 'flex', gap: '12px' }}>
          <button
            className="cancel-btn"
            onClick={onClose}
            style={{
              flex: 1, height: '44px', borderRadius: '10px', background: 'transparent',
              border: '1px solid var(--glass-border)', color: 'var(--text-secondary)',
              fontWeight: 700, cursor: 'pointer', fontSize: '14px'
            }}
          >
            {cancelText}
          </button>
          {extraText && onExtra && (
            <button
              className="extra-btn"
              onClick={() => { onExtra(); onClose(); }}
              style={{
                flex: 1, height: '44px', borderRadius: '10px', background: 'transparent',
                border: '1px solid var(--accent-red)', color: 'var(--accent-red)',
                fontWeight: 700, cursor: 'pointer', fontSize: '14px'
              }}
            >
              {extraText}
            </button>
          )}
          <button 
            className="confirm-btn" 
            onClick={() => { onConfirm(); onClose(); }}
            style={{ 
              flex: 1.5, height: '44px', borderRadius: '10px', 
              background: type === 'danger' ? 'linear-gradient(135deg, var(--accent-red), #ff4d4d)' : 'linear-gradient(135deg, var(--accent-blue), #4f8ef7)', 
              color: '#fff', border: 'none', fontWeight: 800, cursor: 'pointer', fontSize: '14px',
              boxShadow: type === 'danger' ? '0 4px 15px rgba(244, 63, 94, 0.3)' : '0 4px 15px rgba(0, 210, 255, 0.3)'
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
