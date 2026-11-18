import { useState, useMemo } from "react";
import { Reorder } from "framer-motion";
import { Server, Plus, MonitorPlay } from "lucide-react";
import { HyperVCard } from "@/components/RackAsset";
import { RemoteAssetRow } from "@/components/RemotePage";
import { ColumnToggle } from "@/components/ColumnToggle";
import { NetworkPage } from "@/components/NetworkPage";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/contexts/SettingsContext";
import type { VmInfo, RemoteHost, SystemStats } from "@/types";

interface VmsPageProps {
  vms: VmInfo[];
  /** 아래 네트워크 섹션(호스트 트래픽 그래프)용. */
  statsData?: SystemStats;
  /** Omnissa/Horizon 데스크톱. RDP 호스트와 달리 "원격 자산"이 아니라 가상 머신이라
   *  이 탭에서 관리한다 — 원격 자산 탭에는 RDP만 남는다. */
  horizonHosts: RemoteHost[];
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  onSettings: (vm: VmInfo) => void;
  onCreate: () => void;
  onHostConnect: (host: string, protocol: string, username?: string) => void;
  onHostEdit: (host: RemoteHost) => void;
  onHostMemo: (host: RemoteHost) => void;
  onHostDelete: (id: string) => void;
  onHostAdd: () => void;
  /** VM 드래그 정렬(대시보드에서 옮겨 옴). "전체" 필터 + 1열일 때만 켠다 — 걸러진 목록·2열
   *  그리드에서 끌면 보이지 않는 VM의 자리가 꼬인다. */
  onReorder?: (names: string[]) => void;
}

type VmFilter = "all" | "running" | "paused" | "off";

export function VmsPage({ vms, statsData, horizonHosts, onError, onSuccess, onSettings, onCreate, onHostConnect, onHostEdit, onHostMemo, onHostDelete, onHostAdd, onReorder }: VmsPageProps) {
  const { settings, updateSettings } = useSettings();
  const t = useT();
  const [vmFilter, setVmFilter] = useState<VmFilter>("all");

  const filteredVms = useMemo(() => {
    switch (vmFilter) {
      case "running": return vms.filter(v => v.state === "Running");
      case "paused":  return vms.filter(v => v.state === "Paused" || v.state === "Saved");
      case "off":     return vms.filter(v => v.state === "Off");
      default:        return vms;
    }
  }, [vms, vmFilter]);

  const segments = [
    { id: "all"     as VmFilter, label: t("vms.all"), iconColor: "var(--accent-blue)",   count: vms.length },
    { id: "running" as VmFilter, label: t("vms.running"), iconColor: "var(--accent-green)",  count: vms.filter(v => v.state === "Running").length },
    { id: "paused"  as VmFilter, label: t("vms.paused"), iconColor: "var(--accent-orange)", count: vms.filter(v => v.state === "Paused" || v.state === "Saved").length },
    { id: "off"     as VmFilter, label: t("vms.off"), iconColor: "var(--text-muted)",    count: vms.filter(v => v.state === "Off").length },
  ];

  return (
    <div className="dashboard-grid">
      <div className="hd-segment-bar" style={{ gridColumn: "1 / -1", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: "6px" }}>
          {segments.map(seg => (
            <button
              key={seg.id}
              className={`hd-segment-btn ${vmFilter === seg.id ? "active" : ""}`}
              onClick={() => setVmFilter(seg.id)}
            >
              {/* 상태 점 — 유니코드 기호(■●▪○) 대신 그린 점. "꺼짐"은 속이 빈 링이라 색 없이도 구분된다. */}
              <span aria-hidden style={{
                width: 7, height: 7, borderRadius: seg.id === "all" ? 2 : "50%", flexShrink: 0,
                background: seg.id === "off" ? "transparent" : (vmFilter === seg.id ? seg.iconColor : "var(--text-muted)"),
                boxShadow: seg.id === "off" ? `inset 0 0 0 1.5px ${vmFilter === seg.id ? "var(--text-secondary)" : "var(--text-muted)"}` : "none",
              }} />
              {seg.label}
              {seg.count > 0 && <span className="hd-segment-count">{seg.count}</span>}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ColumnToggle value={settings.vmColumns} onChange={(v) => updateSettings({ vmColumns: v })} />
          <button className="hd-segment-btn" onClick={onCreate} style={{ fontWeight: 800 }} title={t("vms.newVmHint")}>
            <Plus size={13} /> {t("vms.newVm")}
          </button>
        </div>
      </div>

      <div className="section-label" style={{ gridColumn: "1 / -1" }}>
        <Server size={14} color="var(--accent-blue)" />
        <h3>{t("vms.heading")}</h3>
        <div className="section-line" />
      </div>

      <div className="vm-card-list" style={settings.vmColumns === 2
        // Mirror RemotePage's remoteAssetColumns grid: auto-fit + minmax so 2
        // columns only apply while each card keeps ~600px of breathing room,
        // else it collapses to 1 column instead of clipping the card contents.
        ? { gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(600px, 1fr))", gap: "12px" }
        : { gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "12px" }}>
        {filteredVms.length > 0 && onReorder && vmFilter === "all" && settings.vmColumns !== 2 ? (
          <Reorder.Group axis="y" values={vms.map(v => v.name)} onReorder={onReorder} style={{ display: "flex", flexDirection: "column", gap: "12px", listStyle: "none", padding: 0, margin: 0 }}>
            {vms.map((vm, idx) => (
              <Reorder.Item key={vm.name} value={vm.name} style={{ listStyle: "none", margin: 0, padding: 0 }}>
                <HyperVCard vm={vm} animDelay={idx * 50} onError={onError} onSuccess={onSuccess} onSettings={() => onSettings(vm)} />
              </Reorder.Item>
            ))}
          </Reorder.Group>
        ) : filteredVms.length > 0 ? filteredVms.map((vm, idx) => (
          <HyperVCard
            key={vm.name}
            vm={vm}
            animDelay={idx * 50}
            onError={onError}
            onSuccess={onSuccess}
            onSettings={() => onSettings(vm)}
          />
        )) : (
          <div style={{ padding: "48px", textAlign: "center", opacity: 0.3, border: "1px dashed var(--border)", borderRadius: "12px" }}>
            <Server size={28} style={{ marginBottom: "10px" }} />
            <div style={{ fontSize: "12px", fontWeight: 700 }}>{t("vms.noneForFilter")}</div>
          </div>
        )}
      </div>

      {/* ── Omnissa (VDI) ── 원격 자산 탭이 아니라 여기서 관리한다. 줄 자체는
          RemotePage의 랙 줄을 그대로 재사용해서 동작/모양이 갈리지 않게 한다. */}
      <div className="section-label" style={{ gridColumn: "1 / -1", marginTop: "18px" }}>
        <MonitorPlay size={14} color="var(--accent-purple)" />
        <h3>OMNISSA · VDI</h3>
        <div className="section-line" />
        <button className="hd-segment-btn" onClick={onHostAdd} title={t("vms.addOmnissaHint")}>
          <Plus size={13} /> {t("vms.addOmnissa")}
        </button>
      </div>

      <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "4px" }}>
        {horizonHosts.length > 0 ? horizonHosts.map((host) => (
          <RemoteAssetRow
            key={host.id}
            host={host}
            onConnect={onHostConnect}
            onEdit={onHostEdit}
            onMemo={onHostMemo}
            onDelete={onHostDelete}
          />
        )) : (
          <div style={{ padding: "28px", textAlign: "center", opacity: 0.3, border: "1px dashed var(--border)", borderRadius: "12px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700 }}>{t("vms.noOmnissa")}</div>
          </div>
        )}
      </div>

      {/* ── 네트워크 ── 가상 스위치·VM별 스위치·트래픽. 별도 메뉴로 두기엔 작고 VM과
          붙어 있는 정보라 이 페이지 맨 아래에 둔다. NetworkPage는 자기 그리드를 가지므로
          한 칸을 통째로 차지하는 래퍼 안에 넣는다. */}
      <div style={{ gridColumn: "1 / -1", marginTop: "18px" }}>
        <NetworkPage vms={vms} statsData={statsData} netHistory={statsData?.net_history ?? []} />
      </div>
    </div>
  );
}
