// Daily-series bar chart (polish-wanxing-console D3): replaces the hand-rolled
// div bars in the stats view. x = day, one series per caliber source/basis —
// the calibers stay separate, never merged. echarts is imported piecemeal so
// only Bar + Grid + Legend + Canvas land in the chunk.
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, GridComponent, LegendComponent, CanvasRenderer]);

// Fixed palette (not slate/amber gradients): one color per caliber, stable
// across renders so a legend row always maps to the same series.
const COLORS = ["#0ea5e9", "#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#64748b"];

const isDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export function DailyChart({ rows }) {
  const el = useRef(null);
  useEffect(() => {
    if (!el.current) return;
    let chart = null;
    const render = () => {
      if (chart) chart.dispose();
      chart = echarts.init(el.current);
      const dark = isDark();
      const byDay = new Map();
      const calibers = [];
      for (const r of rows) {
        const key = `${r.source}/${r.basis}`;
        if (!calibers.includes(key)) calibers.push(key);
        if (!byDay.has(r.day)) byDay.set(r.day, {});
        byDay.get(r.day)[key] = (byDay.get(r.day)[key] ?? 0) + (r.tokens_in + r.tokens_out);
      }
      const days = [...byDay.keys()].sort();
      chart.setOption({
        color: COLORS,
        textStyle: { color: dark ? "#94a3b8" : "#64748b" },
        legend: { top: 0, textStyle: { color: dark ? "#94a3b8" : "#64748b" } },
        grid: { left: 8, right: 8, top: 28, bottom: 0, containLabel: true },
        xAxis: {
          type: "category",
          data: days,
          axisLine: { lineStyle: { color: dark ? "#475569" : "#cbd5e1" } },
          axisLabel: { fontSize: 10 },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0" } },
          axisLabel: {
            fontSize: 10,
            formatter: (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v),
          },
        },
        series: calibers.map((c) => ({
          name: c,
          type: "bar",
          data: days.map((d) => byDay.get(d)[c] ?? 0),
          barMaxWidth: 18,
        })),
      });
    };
    render();
    // System-scheme flip: re-render with the other palette. The site has no
    // in-app theme toggle — dark follows the OS via Tailwind's dark: variant.
    const mm = window.matchMedia?.("(prefers-color-scheme: dark)");
    mm?.addEventListener?.("change", render);
    return () => {
      mm?.removeEventListener?.("change", render);
      chart?.dispose();
    };
  }, [rows]);
  return <div ref={el} style={{ height: 260 }} data-testid="stats-daily" />;
}
