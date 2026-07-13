import { useState, useMemo } from "react";
import { Server, Plus } from "lucide-react";
import { HyperVCard } from "@/components/RackAsset";
import type { VmInfo } from "@/types";

interface VmsPageProps {
  vms: VmInfo[];
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  onSettings: (vm: VmInfo) => void;
  onCreate: () => void;
}

type VmFilter = "all" | "running" | "paused" | "off";

export function VmsPage({ vms, onError, onSuccess, onSettings, onCreate }: VmsPageProps) {
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
    { id: "all"     as VmFilter, label: "전체",     icon: "■", iconColor: "var(--accent-blue)",   count: vms.length },
    { id: "running" as VmFilter, label: "실행 중",  icon: "●", iconColor: "var(--accent-green)",  count: vms.filter(v => v.state === "Running").length },
    { id: "paused"  as VmFilter, label: "일시정지", icon: "▪", iconColor: "var(--accent-orange)", count: vms.filter(v => v.state === "Paused" || v.state === "Saved").length },
    { id: "off"     as VmFilter, label: "종료",     icon: "○", iconColor: "var(--text-muted)",    count: vms.filter(v => v.state === "Off").length },
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
              <span style={{ fontSize: "10px", color: vmFilter === seg.id ? seg.iconColor : "var(--text-muted)" }}>{seg.icon}</span>
              {seg.label}
              {seg.count > 0 && <span className="hd-segment-count">{seg.count}</span>}
            </button>
          ))}
        </div>
        <button className="hd-segment-btn" onClick={onCreate} style={{ fontWeight: 800 }} title="새 가상 머신 생성">
          <Plus size={13} /> 새 VM
        </button>
      </div>

      <div className="section-label" style={{ gridColumn: "1 / -1" }}>
        <Server size={14} color="var(--accent-blue)" />
        <h3>가상 머신 관리</h3>
        <div className="section-line" />
      </div>

      <div className="vm-card-list" style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "12px" }}>
        {filteredVms.length > 0 ? filteredVms.map((vm, idx) => (
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
            <div style={{ fontSize: "12px", fontWeight: 700 }}>해당 조건의 가상 머신이 없습니다.</div>
          </div>
        )}
      </div>
    </div>
  );
}
