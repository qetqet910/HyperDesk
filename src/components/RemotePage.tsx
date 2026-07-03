import { Globe, Plus } from "lucide-react";
import type { RemoteHost } from "../types";

interface RemotePageProps {
  remoteHosts: RemoteHost[];
  onConnect: (host: string, protocol: string, username?: string) => void;
  onEdit: (host: RemoteHost) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

export function RemotePage({ remoteHosts, onConnect, onEdit, onDelete, onAdd }: RemotePageProps) {
  return (
    <div className="dashboard-grid">
      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)" }}>
          <span style={{ color: "var(--accent-blue)" }}>→</span> Precision Stream · Remote Assets
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "9px", fontWeight: 900, color: "var(--accent-blue)", background: "rgba(110,113,255,0.1)", padding: "2px 10px", borderRadius: "4px", border: "1px solid rgba(110,113,255,0.2)" }}>
            {remoteHosts.length} assets
          </span>
          <button className="hd-segment-btn" onClick={onAdd}>
            <Plus size={13} /> 원격 자산 등록
          </button>
        </div>
      </div>

      <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "4px" }}>
        {remoteHosts.length > 0 ? remoteHosts.map((host) => {
          const isOffline = host.status === "TIMEOUT" || host.status === "Offline";
          const load = host.load ?? 0;
          const proto = host.protocol === "HORIZON" ? "horizon" : "rdp";
          return (
            <div key={host.id} className={`mst-rack-row ${isOffline ? "dead" : ""}`}>
              <div className="mst-rack-ear"><div className="mst-rack-stripe" /></div>
              <div className="mst-rack-status">
                <span className={`mst-rack-led ${isOffline ? "offline" : "online"}`} />
                <span className={`mst-rack-latency ${isOffline ? "offline" : "online"}`}>
                  {isOffline ? "---" : `${host.latency}MS`}
                </span>
              </div>
              <div className="mst-rack-name">
                <span className="mst-rack-hostname">{host.name}</span>
                <span className={`mst-proto-tag ${proto}`}>{host.protocol}</span>
                {host.is_detected && <span className="mst-proto-tag auto">AUTO</span>}
                {host.memo && <span className="mst-rack-memo" title={host.memo}>✎ {host.memo}</span>}
              </div>
              <div className="mst-rack-addr">{host.host}</div>
              <div className="mst-rack-gauge">
                <div className="mst-rack-track">
                  {!isOffline && load > 0 && <div className="mst-rack-fill" style={{ width: `${load}%` }} />}
                </div>
                <span className="mst-rack-pct" style={{ color: isOffline ? "var(--text-muted)" : "var(--text-main)" }}>
                  {isOffline ? "--" : `${Math.round(load)}%`}
                </span>
              </div>
              <div className="mst-rack-actions">
                <button
                  className={`mst-rack-connect ${isOffline ? "disabled" : ""}`}
                  disabled={isOffline}
                  onClick={() => !isOffline && onConnect(host.host, host.protocol, host.username)}
                >
                  CONNECT →
                </button>
                {/* Edit is allowed even for auto-detected hosts (rename / memo /
                    tag); the backend promotes a detected id to a manual entry on
                    save. Delete stays for all — detected hosts are hidden, not
                    purged, so they don't zombie-regenerate from the registry. */}
                <button className="mst-rack-icon-btn" title="편집" onClick={() => onEdit(host)}>✎</button>
                <button className="mst-rack-icon-btn mst-rack-icon-btn--del" title={host.is_detected ? "숨기기" : "삭제"} onClick={() => onDelete(host.id)}>✕</button>
              </div>
            </div>
          );
        }) : (
          <div style={{ padding: "60px", textAlign: "center", opacity: 0.3, border: "1px dashed var(--border)", borderRadius: "12px" }}>
            <Globe size={32} style={{ marginBottom: "12px" }} />
            <div style={{ fontSize: "13px", fontWeight: 700 }}>원격 자산 없음</div>
            <div style={{ fontSize: "11px", marginTop: "6px" }}>"원격 자산 등록" 버튼으로 RDP / Horizon 호스트를 추가하세요.</div>
          </div>
        )}
      </div>
    </div>
  );
}
