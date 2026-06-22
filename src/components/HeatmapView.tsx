import type { VmInfo } from "../types";

interface HeatmapViewProps {
  vms: VmInfo[];
  onVmClick: (vm: VmInfo) => void;
}

function getHealthColor(vm: VmInfo): { bg: string; border: string; glow: string } {
  if (vm.state !== "Running") {
    return { bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.2)", glow: "none" };
  }
  const cpu = vm.cpu_usage ?? 0;
  const memRatio = vm.memory_demand > 0 ? vm.memory_demand / vm.memory_assigned : 0;
  const score = Math.max(cpu / 100, memRatio);

  if (score > 0.8) return { bg: "rgba(244,63,94,0.15)",  border: "rgba(244,63,94,0.4)",  glow: "0 0 12px rgba(244,63,94,0.3)" };
  if (score > 0.5) return { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.35)", glow: "0 0 10px rgba(245,158,11,0.2)" };
  return { bg: "rgba(34,197,94,0.1)",  border: "rgba(34,197,94,0.3)",  glow: "0 0 8px rgba(34,197,94,0.15)" };
}

function stateText(state: string): string {
  return ({ Running: "실행 중", Off: "종료", Paused: "일시정지", Saved: "저장됨" } as Record<string, string>)[state] ?? state;
}

function formatMem(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
}

export function HeatmapView({ vms, onVmClick }: HeatmapViewProps) {
  if (vms.length === 0) {
    return (
      <div style={{ padding: "60px", textAlign: "center", opacity: 0.3, border: "1px dashed var(--border)", borderRadius: "12px" }}>
        <div style={{ fontSize: "12px", fontWeight: 500 }}>감지된 VM이 없습니다</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "10px" }}>
      {vms.map(vm => {
        const { bg, border, glow } = getHealthColor(vm);
        const isRunning = vm.state === "Running";
        const cpu = vm.cpu_usage ?? 0;
        const memUsed = vm.memory_demand;
        const memTotal = vm.memory_assigned;
        const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

        return (
          <div
            key={vm.name}
            onClick={() => onVmClick(vm)}
            title={`${vm.name}\nCPU: ${cpu.toFixed(1)}%\n메모리: ${formatMem(memUsed)} / ${formatMem(memTotal)}`}
            style={{
              background: bg,
              border: `1px solid ${border}`,
              boxShadow: glow,
              borderRadius: "10px",
              padding: "12px 14px",
              cursor: "pointer",
              transition: "all 0.15s",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              userSelect: "none",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "none"; }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{
                width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0,
                background: isRunning
                  ? cpu > 80 ? "var(--accent-red)" : cpu > 50 ? "var(--accent-orange)" : "var(--accent-green)"
                  : "var(--text-muted)",
                animation: isRunning ? "dotPulse 2s ease-in-out infinite" : "none",
              }} />
              <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {vm.name}
              </span>
            </div>

            {/* State badge */}
            <div style={{ fontSize: "10px", color: isRunning ? "var(--accent-green)" : "var(--text-muted)", fontWeight: 500 }}>
              {stateText(vm.state)}
            </div>

            {/* Metrics (only when running) */}
            {isRunning && (
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <MiniBar label="CPU" value={cpu} max={100} color={cpu > 80 ? "var(--accent-red)" : cpu > 50 ? "var(--accent-orange)" : "var(--accent-green)"} unit="%" />
                <MiniBar label="MEM" value={memPct} max={100} color="var(--accent-blue)" unit="%" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MiniBar({ label, value, max, color, unit }: { label: string; value: number; max: number; color: string; unit: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{ fontSize: "9px", color: "var(--text-muted)", width: "26px", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: "3px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "2px", transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontSize: "9px", color: "var(--text-muted)", width: "28px", textAlign: "right", flexShrink: 0 }}>
        {value.toFixed(0)}{unit}
      </span>
    </div>
  );
}
