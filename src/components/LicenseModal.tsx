import { X, Package, Type } from "lucide-react";

// In-app mirror of THIRD-PARTY-NOTICES.md (repo root). Kept as a hand-maintained
// list of DIRECT dependencies — same caveat as the notices file: transitive deps
// need cargo-license / license-checker at release time for a legally complete list.
// When you bump a dependency's license or add/remove a direct dep, update BOTH
// this array and THIRD-PARTY-NOTICES.md so the in-app view and the shipped file
// never drift.
interface LicenseEntry {
  name: string;
  license: string;
}

const RUST_DEPS: LicenseEntry[] = [
  { name: "tauri", license: "MIT OR Apache-2.0" },
  { name: "tauri-plugin-opener", license: "MIT OR Apache-2.0" },
  { name: "tauri-plugin-global-shortcut", license: "MIT OR Apache-2.0" },
  { name: "serde / serde_json", license: "MIT OR Apache-2.0" },
  { name: "uuid", license: "MIT OR Apache-2.0" },
  { name: "tokio", license: "MIT" },
  { name: "winreg", license: "MIT" },
  { name: "lazy_static", license: "MIT OR Apache-2.0" },
  { name: "windows (windows-rs, Microsoft)", license: "MIT OR Apache-2.0" },
  { name: "sysinfo", license: "MIT" },
  { name: "futures", license: "MIT OR Apache-2.0" },
];

const JS_DEPS: LicenseEntry[] = [
  { name: "react / react-dom", license: "MIT" },
  { name: "@tauri-apps/api / plugin-opener", license: "MIT OR Apache-2.0" },
  { name: "@tanstack/react-query", license: "MIT" },
  { name: "fuse.js", license: "Apache-2.0" },
  { name: "lucide-react", license: "ISC" },
  { name: "framer-motion", license: "MIT" },
  { name: "recharts", license: "MIT" },
  { name: "sharp (빌드 타임 전용)", license: "Apache-2.0" },
];

const FONT_DEPS: LicenseEntry[] = [
  { name: "펴진고딕 (Pyeojin Gothic) — 서지환 (엔파피)", license: "SIL OFL 1.1" },
];

interface LicenseModalProps {
  onClose: () => void;
}

function LicenseSection({ title, icon, entries }: { title: string; icon: React.ReactNode; entries: LicenseEntry[] }) {
  return (
    <div className="license-section">
      <div className="license-section__head">{icon}<span>{title}</span></div>
      {entries.map((e) => (
        <div className="license-row" key={e.name}>
          <span className="license-row__name">{e.name}</span>
          <span className="license-row__tag">{e.license}</span>
        </div>
      ))}
    </div>
  );
}

export function LicenseModal({ onClose }: LicenseModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: "blur(12px)", background: "rgba(0,0,0,0.7)", zIndex: 1000 }}>
      <div className="modal-content glass-modal" onClick={(e) => e.stopPropagation()} style={{ width: "460px", maxHeight: "80vh", padding: 0, overflow: "hidden", border: "none", display: "flex", flexDirection: "column" }}>
        <div style={{ height: "2px", width: "100%", background: "linear-gradient(90deg, transparent, var(--accent-blue), transparent)" }} />

        <div className="modal-header" style={{ padding: "22px 24px 12px", border: "none", marginBottom: 0 }}>
          <div className="header-title" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "40px", height: "40px", borderRadius: "10px", background: "rgba(255,255,255,0.03)" }}>
              <Package size={22} style={{ color: "var(--accent-blue)" }} />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 900, color: "#fff", letterSpacing: "-0.3px" }}>오픈소스 라이선스</h3>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body license-body" style={{ padding: "0 24px 8px", overflowY: "auto" }}>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.6, wordBreak: "keep-all", marginBottom: "16px" }}>
            HyperDesk는 아래 오픈소스 구성요소를 사용합니다. 모두 permissive 라이선스(MIT / Apache-2.0 / ISC / OFL)이며, 각 라이선스의 저작권 고지 의무를 유지합니다. 직접 의존성 기준 목록입니다.
          </p>
          <LicenseSection title="Rust (백엔드)" icon={<Package size={13} />} entries={RUST_DEPS} />
          <LicenseSection title="JavaScript / TypeScript" icon={<Package size={13} />} entries={JS_DEPS} />
          <LicenseSection title="폰트" icon={<Type size={13} />} entries={FONT_DEPS} />
        </div>

        <div style={{ padding: "14px 24px 20px", background: "rgba(0,0,0,0.2)" }}>
          <button
            className="confirm-btn"
            onClick={onClose}
            style={{ width: "100%", height: "42px", borderRadius: "10px", background: "linear-gradient(135deg, var(--accent-blue), #4f8ef7)", color: "#fff", border: "none", fontWeight: 800, cursor: "pointer", fontSize: "14px" }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
