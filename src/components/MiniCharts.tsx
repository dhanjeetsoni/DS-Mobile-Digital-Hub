import React from "react";
import { inr } from "../utils/indianCurrency";

// Small, dependency-free SVG charts. The project has no chart library
// installed, so these are hand-rolled — they use the app's existing CSS
// variables so they match every theme automatically.

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

// Simple vertical bar chart with a value label above each bar and the
// x-axis label below. Designed for short series (days of week, revenue
// sources, categories) — not meant for hundreds of points.
export const MiniBarChart: React.FC<{
  data: BarDatum[];
  height?: number;
  formatValue?: (n: number) => string;
  emptyLabel?: string;
}> = ({ data, height = 160, formatValue = inr, emptyLabel = "No data yet" }) => {
  if (!data.length || data.every((d) => !d.value)) {
    return <div className="empty">{emptyLabel}</div>;
  }
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const barW = 100 / data.length;
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "flex-end", height, gap: "4px" }}>
        {data.map((d, idx) => {
          const h = Math.max(2, (Math.abs(d.value) / max) * (height - 28));
          return (
            <div
              key={idx}
              style={{
                flex: `0 0 ${barW}%`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                height: "100%",
              }}
              title={`${d.label}: ${formatValue(d.value)}`}
            >
              <div style={{ fontSize: "10px", fontWeight: 800, marginBottom: "3px", color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
                {formatValue(d.value)}
              </div>
              <div
                style={{
                  width: "70%",
                  height: `${h}px`,
                  borderRadius: "5px 5px 2px 2px",
                  background: d.color || (d.value >= 0 ? "var(--green)" : "var(--red)"),
                  transition: "height 0.2s ease",
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
        {data.map((d, idx) => (
          <div
            key={idx}
            style={{ flex: `0 0 ${barW}%`, textAlign: "center", fontSize: "10px", color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
};

export interface LinePoint {
  label: string;
  value: number;
}

// Simple smoothed-free line/area chart for a trend over time (e.g. last 7 /
// 30 days of profit).
export const MiniLineChart: React.FC<{
  data: LinePoint[];
  height?: number;
  color?: string;
  formatValue?: (n: number) => string;
  emptyLabel?: string;
}> = ({ data, height = 140, color = "var(--accent, #6366f1)", formatValue = inr, emptyLabel = "No data yet" }) => {
  if (!data.length) return <div className="empty">{emptyLabel}</div>;
  const width = 600;
  const padX = 8;
  const padY = 16;
  const values = data.map((d) => d.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const yFor = (v: number) => height - padY - ((v - min) / range) * (height - padY * 2);
  const points = data.map((d, i) => `${padX + i * stepX},${yFor(d.value)}`).join(" ");
  const zeroY = yFor(0);
  const areaPoints = `${padX},${zeroY} ${points} ${padX + (data.length - 1) * stepX},${zeroY}`;
  const last = data[data.length - 1];

  return (
    <div style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        <line x1={padX} y1={zeroY} x2={width - padX} y2={zeroY} stroke="var(--line)" strokeWidth={1} strokeDasharray="3,3" />
        <polygon points={areaPoints} fill={color} opacity={0.12} />
        <polyline points={points} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle key={i} cx={padX + i * stepX} cy={yFor(d.value)} r={3} fill={color}>
            <title>{`${d.label}: ${formatValue(d.value)}`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", color: "var(--ink-soft)", marginTop: "2px" }}>
        <span>{data[0].label}</span>
        {data.length > 1 && <span>{last.label}: <b style={{ color }}>{formatValue(last.value)}</b></span>}
      </div>
    </div>
  );
};

// Compact horizontal "share of total" bars — good for revenue-by-source
// breakdowns (Products / Cybercafe / Repairs) inside a small card.
export const MiniShareBars: React.FC<{ data: BarDatum[]; formatValue?: (n: number) => string }> = ({ data, formatValue = inr }) => {
  const total = Math.max(1, data.reduce((a, d) => a + Math.abs(d.value), 0));
  if (data.every((d) => !d.value)) return <div className="empty">No data yet</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {data.map((d, idx) => (
        <div key={idx}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: "4px" }}>
            <span><b>{d.label}</b></span>
            <span>{formatValue(d.value)} · {Math.round((Math.abs(d.value) / total) * 100)}%</span>
          </div>
          <div style={{ background: "var(--surface-soft, #eee)", borderRadius: "6px", height: "10px", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.max(2, (Math.abs(d.value) / total) * 100)}%`,
                background: d.color || (d.value >= 0 ? "var(--green)" : "var(--red)"),
                height: "100%",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
