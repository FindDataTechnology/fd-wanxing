// Live status strip (wanxing-first-visitor 3.2): the footer's "this thing is
// alive" line, fed by the facade's curated public status endpoint — catalog
// size, 7-day turns, pending settlements. Degrades to a static line when the
// endpoint is unreachable (layout never breaks; nothing internal leaks — the
// endpoint serves curated aggregates only).
import { useEffect, useState } from "react";

const STATUS_URL = "/api/wanxing/v1/status";

const fmt = (agg, render) => (agg?.stale || agg?.value == null ? null : render(agg.value));

export function StatusStrip() {
  const [data, setData] = useState(null); // null = not loaded yet; false = failed
  useEffect(() => {
    let alive = true;
    fetch(STATUS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(false); });
    return () => { alive = false; };
  }, []);

  const ok = data && typeof data === "object";
  const parts = ok
    ? [
        fmt(data.agents, (v) => `${v} 个 agent 在役`),
        fmt(data.turns7d, (v) => `近 7 天 ${v} 回合`),
        fmt(data.settlement_pending, (v) => `结算中 ${v.count} 笔`),
      ].filter(Boolean)
    : [];
  const text = parts.length > 0 ? parts.join(" · ") : "萬星服务运行中";

  return (
    <div data-testid="wanxing-status-strip" className="mt-8 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok && parts.length > 0 ? "bg-emerald-500" : "bg-slate-400"}`} />
      <span>{text}</span>
    </div>
  );
}
