import { X, StickyNote, Globe, User, Save } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/tauri-api";
import type { RemoteHost } from "@/types";

interface MemoModalProps {
  host: RemoteHost;
  onClose: () => void;
  /** Called after a successful save so the caller can refetch the dashboard. */
  onSaved: () => void;
}

/** Notepad-style memo for a remote asset: connection info up top (read-only,
    so it doubles as a quick "접속정보" reference) + a free-form memo body.
    Deliberately SEPARATE from AssetModal — a memo is something you open/read
    mid-work, not a form field you dig out of the edit dialog. */
export function MemoModal({ host, onClose, onSaved }: MemoModalProps) {
  const [memo, setMemo] = useState(host.memo ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.setRemoteHostMemo(host.id, memo);
      onSaved();
      onClose();
    } catch (e) {
      console.error("memo save failed", e);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: "blur(12px)", background: "rgba(0,0,0,0.7)", zIndex: 500 }}>
      <div className="modal-content glass-modal memo-modal" onClick={(e) => e.stopPropagation()} style={{ width: "520px", maxWidth: "520px", padding: 0, overflow: "hidden", border: "none", display: "flex", flexDirection: "column", maxHeight: "82vh" }}>
        <div style={{ height: "2px", width: "100%", background: "linear-gradient(90deg, transparent, var(--accent-orange), transparent)" }} />

        <div className="modal-header" style={{ padding: "22px 24px 14px", border: "none", marginBottom: 0 }}>
          <div className="header-title" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <StickyNote size={18} style={{ color: "var(--accent-orange)" }} />
            <h3 style={{ fontSize: "17px", fontWeight: 900, letterSpacing: "-0.3px" }}>{host.name}</h3>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
            <X size={18} />
          </button>
        </div>

        {/* 접속정보 — read-only quick reference */}
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", padding: "0 24px 14px", fontSize: "12px", color: "var(--text-secondary)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Globe size={12} style={{ opacity: 0.6 }} /> {host.host}
          </span>
          <span style={{ fontWeight: 800, color: host.protocol === "HORIZON" ? "var(--accent-purple)" : "var(--accent-blue)" }}>
            {host.protocol}
          </span>
          {host.username && (
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <User size={12} style={{ opacity: 0.6 }} /> {host.username}
            </span>
          )}
          {host.status && <span style={{ opacity: 0.7 }}>{host.status}</span>}
        </div>

        <div style={{ padding: "0 22px", flex: 1, minHeight: 0, display: "flex" }}>
          <textarea
            autoFocus
            placeholder={"메모를 입력하세요…\n예) 접속 계정, 방화벽 포트, 담당자, 점검 이력"}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            style={{
              width: "100%", minHeight: "220px", background: "rgba(0,0,0,0.25)",
              border: "1px solid var(--glass-border)", borderRadius: "12px",
              padding: "14px", color: "var(--text-main)", fontSize: "13px",
              outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7,
            }}
          />
        </div>

        <div className="modal-actions" style={{ padding: "16px 24px 22px", background: "rgba(0,0,0,0.2)", display: "flex", gap: "12px" }}>
          <button
            className="cancel-btn"
            onClick={onClose}
            style={{ flex: 1, height: "44px", borderRadius: "10px", background: "transparent", border: "1px solid var(--glass-border)", color: "var(--text-secondary)", fontWeight: 700, cursor: "pointer", fontSize: "14px" }}
          >
            취소
          </button>
          <button
            className="confirm-btn"
            disabled={saving}
            onClick={handleSave}
            style={{ flex: 1.5, height: "44px", borderRadius: "10px", background: "linear-gradient(135deg, var(--accent-blue), #4f8ef7)", color: "#fff", border: "none", fontWeight: 800, cursor: "pointer", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
          >
            <Save size={15} /> {saving ? "저장 중…" : "메모 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
