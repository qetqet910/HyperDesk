import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle, Trash2, HelpCircle } from "lucide-react";
import { useT } from "@/lib/i18n";

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
  title, message, confirmText, cancelText,
  type = "info", onConfirm, onClose, extraText, onExtra
}: ConfirmModalProps) {
  const t = useT();

  // Esc = 이 확인 창만 취소. capture 단계에서 먼저 받고 전파를 끊는다 — App의 전역 Esc는
  // 열린 창을 **전부** 한꺼번에 닫아서, VM 설정 창 안의 확인 창에서 Esc를 누르면 설정 창까지
  // 닫혀 입력한 CPU/메모리/태그가 날아갔다. SwallowSlot 선택 창과 같은 방식.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

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

  // 항상 body에 띄운다. 부모에 transform/backdrop-filter가 있으면(VM 설정 창의 .glass-modal,
  // 드래그 정렬 중인 카드) position:fixed의 기준이 화면이 아니라 그 부모가 돼서 오버레이가
  // 부모 크기에 갇혔다. 클릭 이벤트는 React 트리를 따라 올라가므로 부모의 stopPropagation은 그대로 듣는다.
  return createPortal(
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.7)', zIndex: 1000 }}>
      <div className="modal-content glass-modal confirm-modal" onClick={(e) => e.stopPropagation()} style={{ width: '380px', padding: 0, overflow: 'hidden', border: 'none' }}>
        {/* Decorative Neon Header Line */}
        <div style={{ height: '2px', width: '100%', background: `linear-gradient(90deg, transparent, ${getAccentColor()}, transparent)` }} />

        <div className="modal-header" style={{ padding: '18px 20px 12px', border: 'none', marginBottom: 0 }}>
          <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)' }}>
              {getIcon()}
            </div>
            {/* 테마 색을 쓴다 — #fff 고정이라 라이트 테마에선 제목이 흰 바탕에 묻혔다. */}
            <h3 style={{ fontSize: '16px', fontWeight: 900, color: 'var(--text-main)', letterSpacing: '-0.3px' }}>{title}</h3>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '0 20px 18px' }}>
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
            {cancelText ?? t("common.cancel")}
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
            {confirmText ?? t("common.ok")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
