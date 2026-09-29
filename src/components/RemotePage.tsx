import { Globe, Plus, Play, Notebook, Pencil, X} from "lucide-react";
import type { RemoteHost } from "@/types";
import { useSettings } from "@/contexts/SettingsContext";
import { ColumnToggle } from "@/components/ColumnToggle";
import { useT } from "@/lib/i18n";

interface RemotePageProps {
  remoteHosts: RemoteHost[];
  onConnect: (host: string, protocol: string, username?: string) => void;
  onEdit: (host: RemoteHost) => void;
  onMemo: (host: RemoteHost) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

/** 랙 한 줄. 원격 자산 탭(RDP)과 가상 머신 탭의 Omnissa 목록이 같은 줄을 쓴다 —
 *  두 탭에서 같은 동작(연결·메모·편집·삭제)을 제공하므로 마크업을 복제하지 않는다. */
export function RemoteAssetRow({ host, onConnect, onEdit, onMemo, onDelete }: {
  host: RemoteHost;
  onConnect: (host: string, protocol: string, username?: string) => void;
  onEdit: (host: RemoteHost) => void;
  onMemo: (host: RemoteHost) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const isOffline = host.status === "TIMEOUT" || host.status === "Offline";
  const proto = host.protocol === "HORIZON" ? "horizon" : "rdp";
  return (
    <div className={`mst-rack-row ${isOffline ? "dead" : ""}`}>
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
      </div>
      {/* 자동 감지 항목은 이름이 곧 주소다 — 같은 값을 두 칸에 찍지 않는다. */}
      <div className={`mst-rack-addr${host.host === host.name ? " is-same" : ""}`}>
        {host.host === host.name ? "" : host.host}
      </div>
      <div className="mst-rack-actions">
        <button
          className={`mst-rack-connect ${isOffline ? "disabled" : ""}`}
          disabled={isOffline}
          title={isOffline ? t("remote.offline") : t("remote.connect")}
          onClick={() => !isOffline && onConnect(host.host, host.protocol, host.username)}
        >
          <Play size={13} />
        </button>
        {/* Edit is allowed even for auto-detected hosts (rename / tag);
            the backend promotes a detected id to a manual entry on save.
            Delete stays for all — detected hosts are hidden, not purged,
            so they don't zombie-regenerate from the registry. */}
        <button className="mst-rack-icon-btn" title={t("remote.memo")} onClick={() => onMemo(host)}><Notebook size={14} /></button>
        <button className="mst-rack-icon-btn" title={t("remote.edit")} onClick={() => onEdit(host)}><Pencil size={14} /></button>
        <button className="mst-rack-icon-btn mst-rack-icon-btn--del" title={host.is_detected ? t("remote.hide") : t("remote.delete")} onClick={() => onDelete(host.id)}><X size={14} /></button>
      </div>
    </div>
  );
}

export function RemotePage({ remoteHosts, onConnect, onEdit, onMemo, onDelete, onAdd }: RemotePageProps) {
  const { settings, updateSettings } = useSettings();
  const t = useT();
  return (
    <div className="dashboard-grid">
      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)" }}>
          <span style={{ color: "var(--accent-blue)" }}>→</span> {t("remote.heading")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "9px", fontWeight: 900, color: "var(--accent-blue)", background: "rgba(110,113,255,0.1)", padding: "2px 10px", borderRadius: "4px", border: "1px solid rgba(110,113,255,0.2)" }}>
            {remoteHosts.length} assets
          </span>
          <ColumnToggle value={settings.remoteAssetColumns} onChange={(v) => updateSettings({ remoteAssetColumns: v })} />
          <button className="hd-segment-btn" onClick={onAdd}>
            <Plus size={13} /> {t("remote.add")}
          </button>
        </div>
      </div>

      <div style={settings.remoteAssetColumns === 2
        // auto-fit + minmax: same reasoning as the dashboard's rack list — 2
        // columns only while each row keeps its ~600px of breathing room (this
        // page's row is wider: memo+edit+delete+CONNECT, vs. the dashboard's
        // memo+CONNECT), else it collapses to 1 column instead of clipping.
        ? { gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(650px, 1fr))", gap: "4px" }
        : { gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "4px" }}>
        {remoteHosts.length > 0 ? remoteHosts.map((host) => (
          <RemoteAssetRow key={host.id} host={host} onConnect={onConnect} onEdit={onEdit} onMemo={onMemo} onDelete={onDelete} />
        )) : (
          <div style={{ padding: "60px", textAlign: "center", opacity: 0.3, border: "1px dashed var(--border)", borderRadius: "12px" }}>
            <Globe size={32} style={{ marginBottom: "12px" }} />
            <div style={{ fontSize: "13px", fontWeight: 700 }}>{t("remote.empty")}</div>
            {/* Omnissa(VDI)는 가상 머신 탭에서 관리한다 — 여기엔 RDP만 남는다. */}
            <div style={{ fontSize: "11px", marginTop: "6px" }}>{t("remote.emptyHint")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
