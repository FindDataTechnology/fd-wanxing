// Deployer console v1: token-gated fleet visibility (board + per-agent
// timeline). Management actions and external-tenant identity (Logto) are the
// next increment — this view is the operations dogfood vehicle.
import { useEffect, useState } from "react";

const TOKEN_KEY = "wanxing-console-token";

const fmtMs = (ms) => (ms == null ? "n/a" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const fmtAgo = (ms) => (ms == null ? "?" : ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`);

export function ConsoleView() {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [draft, setDraft] = useState("");
  const [board, setBoard] = useState(null);
  const [boardErr, setBoardErr] = useState(null);
  const [agent, setAgent] = useState("");
  const [timeline, setTimeline] = useState(null);
  const [tlErr, setTlErr] = useState(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    const load = () =>
      fetch("/api/fleet/v1/board", { headers: { Authorization: `Bearer ${token}` } })
        .then(async (r) => {
          if (!r.ok) throw new Error(`board HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => live && (setBoard(d), setBoardErr(null)))
        .catch((e) => live && setBoardErr(String(e?.message || e)));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [token]);

  useEffect(() => {
    if (!token || !agent) return;
    let live = true;
    setTlErr(null);
    fetch(`/api/fleet/v1/agents/${encodeURIComponent(agent)}/timeline?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`timeline HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => live && setTimeline(d))
      .catch((e) => live && setTlErr(String(e?.message || e)));
    return () => {
      live = false;
    };
  }, [token, agent]);

  if (!token) {
    return (
      <div className="max-w-sm mx-auto mt-16 space-y-3">
        <h1 className="text-xl font-semibold">部署者控制台</h1>
        <p className="text-sm text-slate-500">输入萬星服务凭据（观测面 token）以继续。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            localStorage.setItem(TOKEN_KEY, draft);
            setToken(draft);
          }}
          className="space-y-3"
        >
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="service token"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
          <button className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm">
            进入
          </button>
        </form>
      </div>
    );
  }

  const states = board?.states ?? {};
  const runners = Object.entries(board?.runners ?? {});
  const lag = board?.ingest_lag ?? [];
  const pending = board?.settled_pending ?? {};
  const wake = board?.wake_ms ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">机群总览</h1>
        <span className="text-xs text-slate-400">
          {board ? `${board.window ?? "24h"} 窗口 · 30s 自动刷新` : ""}
        </span>
        <button
          onClick={() => {
            localStorage.removeItem(TOKEN_KEY);
            setToken("");
          }}
          className="ml-auto text-xs text-slate-400 underline"
        >
          退出
        </button>
      </div>

      {boardErr ? (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm">
          观测面读取失败（{boardErr}）
        </div>
      ) : board ? (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-2xl font-semibold">{board.agents_total ?? 0}</span>
            <span className="text-sm text-slate-500 mr-2">agents</span>
            {Object.entries(states).map(([k, v]) => (
              <span key={k} className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800">
                {k} <b>{Number(v)}</b>
              </span>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm space-y-1.5">
              <div className="font-semibold mb-1">24h</div>
              <div>回合 / 错误：<b>{board.turns ?? 0}</b> / <b>{board.errors ?? 0}</b></div>
              <div>唤醒 p50/p95：<b>{fmtMs(wake.p50)}</b> / <b>{fmtMs(wake.p95)}</b></div>
              <div>budget kill / 退温：<b>{board.budget_kills ?? 0}</b> / <b>{board.reaped ?? 0}</b></div>
              <div>计费：<b>{board.minutes_billed ?? 0}</b> 分钟 · <b>${Number(board.usd ?? 0).toFixed(2)}</b></div>
              <div className={pending.count ? "text-amber-600 dark:text-amber-400" : ""}>
                结算 pending：<b>{pending.count ?? 0}</b>{pending.usd ? `（$${Number(pending.usd).toFixed(2)}）` : ""}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm space-y-2">
              <div className="font-semibold">runners</div>
              {runners.length === 0 && <div className="text-slate-500">窗口内无 runner_stats</div>}
              {runners.map(([id, s]) => (
                <div key={id} className="font-mono text-xs">
                  {id} — child {s.children ?? "?"}/{s.agents ?? "?"} · {Math.round(s.budget_mb ?? 0)}/{s.budget_mb_limit ?? "?"}MB{Number(s.queued) > 0 ? ` · 排队 ${s.queued}` : ""}
                </div>
              ))}
              <div className="font-semibold pt-2">摄取滞后</div>
              {lag.length === 0 && <div className="text-slate-500">无近期事件</div>}
              {lag.map((l) => (
                <div key={l.source} className="font-mono text-xs flex justify-between">
                  <span>{l.source}</span>
                  <span className={Number(l.event_age_ms) > 300_000 ? "text-amber-600 dark:text-amber-400" : ""}>
                    事件 {fmtAgo(l.event_age_ms)} · 到达 {fmtAgo(l.arrival_age_ms)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="text-sm text-slate-500">观测面加载中…</div>
      )}

      <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
        <h2 className="font-semibold">单 agent 时间线</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTimeline(null);
          }}
          className="flex gap-2"
        >
          <input
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            placeholder="agent slug（见目录页，如 packs-xxxx-agent）"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono"
          />
          <button className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm">查询</button>
        </form>
        {tlErr && <div className="text-sm text-amber-600 dark:text-amber-400">时间线读取失败（{tlErr}）</div>}
        {timeline && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-900">
            {(timeline.events ?? []).length === 0 && <div className="p-4 text-sm text-slate-500">无事件</div>}
            {(timeline.events ?? []).map((e) => (
              <div key={e.id} className="px-4 py-2 flex items-center gap-3 text-xs">
                <span className="text-slate-400 w-36 shrink-0 font-mono">{new Date(Number(e.ts)).toLocaleString("zh-CN", { hour12: false })}</span>
                <span className="font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{e.kind}</span>
                <span className="text-slate-500 truncate">{JSON.stringify(e.payload ?? {})}</span>
                {e.trace_id && <span className="text-slate-300 font-mono ml-auto">↔ {e.trace_id.slice(0, 10)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
