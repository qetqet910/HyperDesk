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
  const lastIndex = chartData.length - 1;
  return (
    <div style={{ height, width: "100%", position: "relative" }}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 6, right: 6, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              {/* Area fill is a wash, not a saturated block — ~10% opacity per spec */}
              <stop offset="5%" stopColor={color} stopOpacity={0.12} />
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
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fillOpacity={1}
            fill={`url(#${gradId})`}
            isAnimationActive={false}
            // End-dot marks "now" — the one point worth a permanent marker (spec:
            // >=8px/r>=4, filled with the series color, 2px surface-color ring so
            // it stays legible crossing the line). Every other point renders nothing.
            dot={(props: unknown) => {
              const { cx, cy, index } = props as { cx?: number; cy?: number; index: number };
              if (index !== lastIndex || cx == null || cy == null) return <g key={`d-${index}`} />;
              return (
                <g key="end-dot">
                  <circle cx={cx} cy={cy} r={6} fill="var(--bg-card)" />
                  <circle cx={cx} cy={cy} r={4} fill={color} />
                </g>
              );
            }}
            activeDot={{ r: 4, fill: color, stroke: "var(--bg-card)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
