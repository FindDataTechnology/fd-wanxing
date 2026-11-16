// Live status readout (wanxing-first-visitor 3.2, wanxing-first-impression 5.1):
// fed by the facade's curated public status endpoint — catalog size, 7-day
// turns, pending settlements. Two consumers: the landing's readout row and the
// footer strip. Each fetches independently and degrades independently: a
// landing that cannot read status must not blank out, and a footer outage must
// not take the landing with it. (Two same-URL requests; a shared cache is worth
// adding only if a real measurement says the first paint suffers.)
import { useEffect, useState } from "react";

const STATUS_URL = "/api/wanxing/v1/status";

/** null = not loaded yet; false = failed; object = payload. */
export function usePublicStatus() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(STATUS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setData(d && typeof d === "object" ? d : false); })
      .catch(() => { if (alive) setData(false); });
    return () => { alive = false; };
  }, []);
  return data;
}

const fmt = (agg, render) => (agg?.stale || agg?.value == null ? null : render(agg.value));

/**
 * The readouts, each already rendered. An entry is null when its aggregate is
 * stale or absent — callers drop the nulls rather than printing a zero.
 *
 * "N 个 agent 在役" was a lie: the aggregate is the CATALOG SIZE, and 在役 is
 * one of七 status facts (19 listed vs 4 actually in service). It now says
 * what the number is.
 */
export function statusReadouts(data) {
  if (!data || typeof data !== "object") return [];
  return [
    fmt(data.agents, (v) => ({ value: v, label: "个 agent 已上线" })),
    fmt(data.turns7d, (v) => ({ value: v, label: "近 7 天回合" })),
    fmt(data.settlement_pending, (v) => ({ value: v.count, label: "结算中" })),
  ].filter(Boolean);
}

/** One line of readouts, for the footer strip. */
export function statusLine(data) {
  const rows = statusReadouts(data);
  if (!rows.length) return "萬星服务运行中";
  return rows.map((r) => (r.label === "近 7 天回合" ? `近 7 天 ${r.value} 回合` : `${r.value} ${r.label}`)).join(" · ");
}

export function StatusStrip() {
  const data = usePublicStatus();
  const live = statusReadouts(data).length > 0;
  return (
    <div data-testid="wanxing-status-strip" className="mt-8 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-slate-400"}`} />
      <span>{statusLine(data)}</span>
    </div>
  );
}
