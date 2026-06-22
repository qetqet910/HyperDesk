import { ToastMessage } from "../hooks/useToast";
import { AlertCircle, X } from "lucide-react";

interface ToastProps {
  toasts: ToastMessage[];
  onClose: (id: string) => void;
}

export function Toast({ toasts, onClose }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item ${toast.type}`}>
          <div className="toast-icon">
            {toast.type === "success" ? (
              <SuccessIcon />
            ) : toast.type === "error" ? (
              <AlertCircle size={18} />
            ) : (
              <InfoIcon />
            )}
          </div>
          <div className="toast-body">{toast.message}</div>
          <button className="toast-close" onClick={() => onClose(toast.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SuccessIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
