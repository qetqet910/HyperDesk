import { X, Package, Type } from "lucide-react";
import { useT } from "@/lib/i18n";

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
  { name: "tauri", license: "Apache-2.0 OR MIT" },
  { name: "tauri-plugin-opener", license: "Apache-2.0 OR MIT" },
  { name: "tauri-plugin-global-shortcut", license: "Apache-2.0 OR MIT" },
  { name: "tauri-plugin-updater", license: "Apache-2.0 OR MIT" },
  { name: "tauri-plugin-process", license: "Apache-2.0 OR MIT" },
  { name: "tauri-plugin-single-instance", license: "Apache-2.0 OR MIT" },
  { name: "serde / serde_json", license: "MIT OR Apache-2.0" },
  { name: "uuid", license: "Apache-2.0 OR MIT" },
  { name: "tokio", license: "MIT" },
  { name: "futures", license: "MIT OR Apache-2.0" },
  { name: "winreg", license: "MIT" },
  { name: "windows (windows-rs, Microsoft)", license: "MIT OR Apache-2.0" },
  { name: "sysinfo", license: "MIT" },
];

const JS_DEPS: LicenseEntry[] = [
  { name: "react / react-dom", license: "MIT" },
  { name: "@tauri-apps/api", license: "Apache-2.0 OR MIT" },
  { name: "@tauri-apps/plugin-opener / updater / process", license: "MIT OR Apache-2.0" },
  { name: "@tanstack/react-query", license: "MIT" },
  { name: "@lottiefiles/dotlottie-react / dotlottie-web", license: "MIT" },
  { name: "framer-motion", license: "MIT" },
  { name: "recharts", license: "MIT" },
  { name: "fuse.js", license: "Apache-2.0" },
  { name: "lucide-react", license: "ISC" },
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
  const t = useT();
  // 로딩 애니메이션 항목만 번역이 필요해서 렌더 때 붙인다(폰트 이름은 고유명사).
  const fontDeps = [...FONT_DEPS, { name: t("lic.loadingAnim"), license: "Lottie Simple License" }];
  return (
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: "blur(12px)", background: "rgba(0,0,0,0.7)", zIndex: 1000 }}>
      <div className="modal-content glass-modal" onClick={(e) => e.stopPropagation()} style={{ width: "420px", maxHeight: "80vh", padding: 0, overflow: "hidden", border: "none", display: "flex", flexDirection: "column" }}>
        <div style={{ height: "2px", width: "100%", background: "linear-gradient(90deg, transparent, var(--accent-blue), transparent)" }} />

        <div className="modal-header" style={{ padding: "18px 20px 12px", border: "none", marginBottom: 0 }}>
          <div className="header-title" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "40px", height: "40px", borderRadius: "10px", background: "rgba(255,255,255,0.03)" }}>
              <Package size={22} style={{ color: "var(--accent-blue)" }} />
            </div>
            <h3 style={{ fontSize: "16px", fontWeight: 900, color: "#fff", letterSpacing: "-0.3px" }}>{t("lic.title")}</h3>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body license-body" style={{ padding: "0 20px 8px", overflowY: "auto" }}>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.6, wordBreak: "keep-all", marginBottom: "16px" }}>
            {t("lic.body")}
          </p>
          <LicenseSection title={t("lic.rust")} icon={<Package size={13} />} entries={RUST_DEPS} />
          <LicenseSection title="JavaScript / TypeScript" icon={<Package size={13} />} entries={JS_DEPS} />
          <LicenseSection title={t("lic.fonts")} icon={<Type size={13} />} entries={fontDeps} />
        </div>

        <div style={{ padding: "12px 20px 16px", background: "rgba(0,0,0,0.2)" }}>
          <button
            className="confirm-btn"
            onClick={onClose}
            style={{ width: "100%", height: "38px", borderRadius: "9px", background: "linear-gradient(135deg, var(--accent-blue), #4f8ef7)", color: "#fff", border: "none", fontWeight: 800, cursor: "pointer", fontSize: "14px" }}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
