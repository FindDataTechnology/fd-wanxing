// 消耗视图 (add-stats-plane-v1 4.x): three calibers side by side — fleet
// (estimated), sub2api (billed), local (estimated). The server never merges
// calibers and neither does this view; every figure block carries its label.

import { useEffect, useState } from "react";
import { authFetch } from "../../auth.js";

const DAY_CHOICES = [1, 7, 30, 90];

const fmtTok = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return String(v);
};

function CaliberCard({ label, tone, children }) {
  const toneCls = tone === "billed"
    ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950"
    : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900";
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneCls}`} data-testid={`stats-caliber-${label}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      {children}
    </div>
  );
}

export function StatsView() {
  const [days, setDays] = useState(7);
  const [overview, setOverview] = useState(null);
  const [byAgent, setByAgent] = useState(null);
  const [byModel, setByModel] = useState(null);
  const [daily, setDaily] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    const q = `?days=${days}`;
    Promise.all([
      authFetch(`/api/fleet/v1/stats/overview${q}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`overview HTTP ${r.status}`)))),
      authFetch(`/api/fleet/v1/stats/by-agent${q}`).then((r) => r.json()),
      authFetch(`/api/fleet/v1/stats/by-model${q}`).then((r) => r.json()),
      authFetch(`/api/fleet/v1/stats/daily${q}`).then((r) => r.json()),
    ])
      .then(([ov, ba, bm, dl]) => {
        if (!alive) return;
        setOverview(ov);
        setByAgent(ba);
        setByModel(bm);
        setDaily(dl);
      })
      .catch((e) => alive && setErr(String(e?.message || e)));
    return () => { alive = false; };
  }, [days]);

  const fleetRows = overview?.fleet ?? [];
  const sub2api = overview?.sub2api ?? null;
  const stale = overview?.sub2api_stale_since ?? null;

  return (
    <section className="space-y-4" data-testid="stats-view">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold">消耗</h2>
        <div className="flex gap-1">
          {DAY_CHOICES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-xs px-2.5 py-1 rounded-full border ${days === d ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-transparent" : "border-slate-300 dark:border-slate-700 text-slate-500"}`}
              data-testid={`stats-days-${d}`}
            >
              {d === 1 ? "24h" : `${d}天`}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm">
          统计面不可用：{err}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        <CaliberCard label="fleet · 估算（回合口径）" tone="estimated">
          {fleetRows.length === 0 && <div className="text-sm text-slate-400 py-2">窗口内无数据</div>}
          {fleetRows.map((f) => (
            <div key={`${f.source}:${f.basis}`} className="py-1">
              <div className="text-lg font-semibold tabular-nums">
                {fmtTok(f.tokens_in + f.tokens_out)} tok
              </div>
              <div className="text-xs text-slate-500">
                {f.turns} 回合 · {f.agents} agent · in {fmtTok(f.tokens_in)} / out {fmtTok(f.tokens_out)} · {f.basis}
              </div>
            </div>
          ))}
        </CaliberCard>
        <CaliberCard label="sub2api · 计费（钱面真源）" tone="billed">
          {!sub2api && <div className="text-sm text-slate-400 py-2">未配置或窗口内无聚合</div>}
          {sub2api && (
            <div className="py-1">
              <div className="text-lg font-semibold tabular-nums">{fmtTok(sub2api.tokens_in + sub2api.tokens_out)} tok</div>
              <div className="text-xs text-slate-500">{sub2api.requests} 请求 · {sub2api.rows} 行/天聚合 · billed</div>
              {stale && (
                <div className="text-xs text-amber-600">
                  最近成功拉取：{new Date(stale).toLocaleString()}（可能滞后）
                </div>
              )}
            </div>
          )}
        </CaliberCard>
        <CaliberCard label="local · 估算（开发机 harness）" tone="estimated">
          {(() => {
            const loc = fleetRows.find((f) => f.source === "local");
            if (!loc) return <div className="text-sm text-slate-400 py-2">无本地采集数据（collector 未跑或无新回合）</div>;
            return (
              <div className="py-1">
                <div className="text-lg font-semibold tabular-nums">{fmtTok(loc.tokens_in + loc.tokens_out)} tok</div>
                <div className="text-xs text-slate-500">{loc.turns} 回合 · estimated</div>
              </div>
            );
          })()}
        </CaliberCard>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-500 mb-2">按 agent（fleet/local 口径）</div>
          <table className="w-full text-sm tabular-nums" data-testid="stats-by-agent">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-1">agent</th><th>pack</th><th>口径</th><th className="text-right">回合</th><th className="text-right">tokens</th>
              </tr>
            </thead>
            <tbody>
              {(byAgent?.rows ?? []).slice(0, 20).map((r) => (
                <tr key={`${r.agent}|${r.pack}|${r.source}|${r.basis}`} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-2 truncate max-w-[14rem]">{r.agent}</td>
                  <td className="pr-2 text-slate-500 truncate max-w-[8rem]">{r.pack || "—"}</td>
                  <td className="pr-2 text-xs">{r.source}/{r.basis}</td>
                  <td className="text-right">{r.turns}</td>
                  <td className="text-right">{fmtTok(r.tokens_in + r.tokens_out)}</td>
                </tr>
              ))}
              {(byAgent?.rows ?? []).length === 0 && (
                <tr><td colSpan={5} className="py-2 text-slate-400">窗口内无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-500 mb-2">按模型</div>
          <table className="w-full text-sm tabular-nums" data-testid="stats-by-model">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-1">model</th><th>口径</th><th className="text-right">回合</th><th className="text-right">tokens</th>
              </tr>
            </thead>
            <tbody>
              {(byModel?.rows ?? []).slice(0, 20).map((r) => (
                <tr key={`${r.model}|${r.source}|${r.basis}`} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-2 truncate max-w-[16rem]">{r.model || "（fleet 事件未带模型）"}</td>
                  <td className="pr-2 text-xs">{r.source}/{r.basis}</td>
                  <td className="text-right">{r.turns}</td>
                  <td className="text-right">{fmtTok(r.tokens_in + r.tokens_out)}</td>
                </tr>
              ))}
              {(byModel?.rows ?? []).length === 0 && (
                <tr><td colSpan={4} className="py-2 text-slate-400">窗口内无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
        <div className="text-xs font-semibold text-slate-500 mb-2">每日序列（口径分列）</div>
        <div className="space-y-1 max-h-64 overflow-auto" data-testid="stats-daily">
          {(daily?.fleet ?? []).map((d) => (
            <div key={`${d.day}|${d.source}|${d.basis}`} className="flex items-center gap-2 text-xs tabular-nums">
              <span className="w-24 text-slate-500">{d.day}</span>
              <span className="w-24">{d.source}/{d.basis}</span>
              <span className="flex-1">
                <span
                  className="block h-2 rounded bg-slate-400 dark:bg-slate-500"
                  style={{ width: `${Math.min(100, ((d.tokens_in + d.tokens_out) / Math.max(1, Math.max(...(daily?.fleet ?? [{ tokens_in: 0, tokens_out: 0 }]).map((x) => x.tokens_in + x.tokens_out)))) * 100)}%` }}
                />
              </span>
              <span className="w-20 text-right">{fmtTok(d.tokens_in + d.tokens_out)}</span>
              <span className="w-14 text-right text-slate-400">{d.turns}t</span>
            </div>
          ))}
          {(daily?.fleet ?? []).length === 0 && <div className="text-sm text-slate-400 py-2">窗口内无数据</div>}
        </div>
      </div>
    </section>
  );
}
