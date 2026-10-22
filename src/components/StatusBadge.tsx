import { useT, type Key } from "@/lib/i18n";

interface StatusBadgeProps {
  /** VM 상태(Running/Off/…) 또는 Omnissa 호스트 상태(Online/Offline). 표에 없으면 그대로 찍는다. */
  state: string;
}

const STATE_CONFIG: Record<string, { label: Key; className: string; pulse: boolean }> = {
  Running: { label: "vmState.Running", className: "running", pulse: true },
  Off: { label: "vmState.Off", className: "off", pulse: false },
  Paused: { label: "vmState.Paused", className: "paused", pulse: false },
  Saved: { label: "vmState.Saved", className: "paused", pulse: false },
  Starting: { label: "vmState.Starting", className: "starting", pulse: true },
  Stopping: { label: "vmState.Stopping", className: "stopping", pulse: true },
  // 온라인은 실행 중과 같은 초록이다 — 예전엔 표에 없어서 회색(off)으로 떨어졌다.
  Online: { label: "status.online", className: "running", pulse: true },
  Offline: { label: "status.offline", className: "off", pulse: false },
};

export function StatusBadge({ state }: StatusBadgeProps) {
  const t = useT();
  const config = STATE_CONFIG[state];
  return (
    <span className={`status-badge ${config?.className ?? "off"}`}>
      <span className={`status-dot${config?.pulse ? " pulse" : ""}`} />
      {config ? t(config.label) : state}
    </span>
  );
}
