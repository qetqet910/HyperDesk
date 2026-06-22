import { useMemo } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  suffix?: string;
}

export function Sparkline({ data, color = "var(--accent-blue)", height = 30, suffix = "" }: SparklineProps) {
  const chartData = useMemo(() => data.map((v, i) => ({ value: v, id: i })), [data]);
  if (data.length < 2) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "var(--text-muted)", opacity: 0.5, letterSpacing: "1px" }}>
      GATHERING TELEMETRY...
    </div>
  );
  const gradId = `grad-${color.replace(/[(),#\s]/g, "")}`;
  return (
    <div style={{ height, width: "100%", position: "relative" }}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <RechartsTooltip
            content={({ active, payload }) => active && payload?.length ? (
              <div style={{ background: "rgba(0,0,0,0.9)", padding: "4px 10px", borderRadius: "6px", border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`, fontSize: "10px", color, fontWeight: 800 }}>
                {Number(payload[0].value).toFixed(1)}{suffix}
              </div>
            ) : null}
            cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 3" }}
            position={{ y: -20 }}
          />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fillOpacity={1} fill={`url(#${gradId})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
