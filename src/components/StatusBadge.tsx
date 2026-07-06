import type { VmInfo } from "@/types";

interface StatusBadgeProps {
  state: VmInfo["state"];
}

const STATE_CONFIG: Record<string, { label: string; className: string; pulse: boolean }> = {
  Running: { label: "Running", className: "running", pulse: true },
  Off: { label: "Off", className: "off", pulse: false },
  Paused: { label: "Paused", className: "paused", pulse: false },
  Saved: { label: "Saved", className: "paused", pulse: false },
  Starting: { label: "Starting...", className: "starting", pulse: true },
  Stopping: { label: "Stopping...", className: "stopping", pulse: true },
};

export function StatusBadge({ state }: StatusBadgeProps) {
  const config = STATE_CONFIG[state] ?? { label: state, className: "off", pulse: false };
  return (
    <span className={`status-badge ${config.className}`}>
      <span className={`status-dot${config.pulse ? " pulse" : ""}`} />
      {config.label}
    </span>
  );
}
