// 运维面 (refactor-console-ia, M4④ 前置): the ops surfaces — the fleet board
// (30s poll while this tab is shown), the per-agent timeline drill-down, and
// the ops plan manager. Moved verbatim from the ConsoleView monolith; the ops
// token's management gate is unchanged (logged-in identities read).
import { useEffect, useState } from "react";
import { authFetch } from "../../auth.js";
import { fmtAgo, fmtMs } from "./shared.jsx";

export function OpsView() {
  const [board, setBoard] = useState(null);
  const [boardErr, setBoardErr] = useState(null);
  const [agent, setAgent] = useState("");
  const [timeline, setTimeline] = useState(null);
  const [tlErr, setTlErr] = useState(null);
  // Ops plan manager (add-serving-plans).
  const [plans, setPlans] = useState(null);
  const [planErr, setPlanErr] = useState("");
  const [planDraft, setPlanDraft] = useState({ email: "", limit: "", note: "" });
  const [planBusy, setPlanBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      authFetch("/api/fleet/v1/board")
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
  }, []);

  useEffect(() => {
    if (!agent) return;
    let live = true;
    setTlErr(null);
    authFetch(`/api/fleet/v1/agents/${encodeURIComponent(agent)}/timeline?limit=50`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`timeline HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => live && setTimeline(d))
      .catch((e) => live && setTlErr(String(e?.message || e)));
    return () => {
      live = false;
    };
  }, [agent]);

  const loadPlans = () =>
    authFetch("/api/wanxing/v1/console/plans")
      .then(async (r) => {
        if (r.status === 403) throw new Error("套餐管理需要 ops 服务令牌（登录身份不可管理）");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (setPlans(d), setPlanErr("")))
      .catch((e) => setPlanErr(String(e?.message || e)));

  useEffect(() => {
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePlan = async (e) => {
    e.preventDefault();
    setPlanBusy(true);
    try {
      const limit = Number(planDraft.limit);
      const r = await authFetch("/api/wanxing/v1/console/plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: planDraft.email, limitMinutes: limit, note: planDraft.note }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setPlanDraft({ email: "", limit: "", note: "" });
      loadPlans();
    } catch (err) {
      setPlanErr(String(err?.message || err));
    } finally {
      setPlanBusy(false);
    }
  };

  const states = board?.states ?? {};
  const runners = Object.entries(board?.runners ?? {});
  const lag = board?.ingest_lag ?? [];
  const pending = board?.settled_pending ?? {};
  const wake = board?.wake_ms ?? {};
  // 短期执行 (add-fleet-cell-views): cell 遥测段——board.cells 缺席=observer 未升级。
  const cells = Object.entries(board?.cells ?? {});
  const st = board?.shortterm ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">机群总览</h2>
        <span className="text-xs text-slate-400">{board ? `${board.window ?? "24h"} 窗口 · 30s 自动刷新` : ""}</span>
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
            {st && (
              <span className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800">
                短期在跑 <b>{st.running}</b> · 排队 <b>{st.queued}</b> · cells <b>{st.cells}</b>
              </span>
            )}
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
                  {id}{s.pod ? <span className="ml-1 px-1 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" title="pod 共宿模式（密度档）">pod</span> : null} — child {s.children ?? "?"}/{s.agents ?? "?"} · {Math.round(s.budget_mb ?? 0)}/{s.budget_mb_limit ?? "?"}MB{Number(s.queued) > 0 ? ` · 排队 ${s.queued}` : ""}
                </div>
              ))}
              <div className="font-semibold pt-2">任务（24h）</div>
              {board.missions === undefined && <div className="text-slate-500">暂无数据（observer 未升级）</div>}
              {board.missions?.length === 0 && <div className="text-slate-500">窗口内无任务</div>}
              {(board.missions ?? []).slice(0, 8).map((m) => (
                <div key={m.id} className="text-xs flex gap-2 items-center">
                  <span className={`px-1.5 rounded font-mono ${m.status === "reported" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : m.status === "failed" || m.status === "aborted" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>{m.status}</span>
                  <span className="font-mono text-slate-400">{(m.id || "").slice(0, 12)}</span>
                  <span className="truncate">{m.owner || "—"}</span>
                  {m.spent != null && <span>{m.spent} 分钟</span>}
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

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm space-y-2" data-testid="cells-panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">短期执行 · cells <span className="text-xs font-normal text-slate-400">（30 分钟水位 · 只读代采）</span></div>
          {st && (
            <div className="text-xs text-slate-500">
              cells <b>{st.cells}</b> · 在跑 <b>{st.running}</b> · 排队 <b>{st.queued}</b> · worker <b>{st.workers_busy}</b>busy/<b>{st.workers_idle}</b>idle/<b>{st.workers_cap}</b>cap
            </div>
          )}
        </div>
        {board?.cells === undefined && <div className="text-slate-500">暂无数据（observer 未升级）</div>}
        {board?.cells !== undefined && cells.length === 0 && <div className="text-slate-500">窗口内无 cell 遥测（gateway 未配置 FLEET_INGEST_URL）</div>}
        {cells.map(([id, c]) => (
          <div key={id} className="font-mono text-xs flex flex-wrap gap-x-4 gap-y-1 items-baseline">
            <span className="text-slate-400 truncate max-w-64" title={id}>{id}</span>
            <span>在跑 <b>{c.executions?.running ?? 0}</b> · 排队 <b>{c.executions?.queued ?? 0}</b></span>
            <span>worker {c.workers?.busy ?? 0}/{c.workers?.idle ?? 0}/{c.workers?.cap ?? 0}</span>
            <span>jobs {c.jobs ?? 0}{c.agentBusy ? " · 主槽忙" : ""}</span>
            <span className="text-slate-500">1h ✓{c.recent?.done ?? 0} ✗{c.recent?.failed ?? 0} ⏸{c.recent?.interrupted ?? 0}</span>
            <span className="text-slate-400 ml-auto">{fmtAgo(Date.now() - Number(c.seen_at ?? 0))}</span>
          </div>
        ))}
      </div>

      <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
        <h3 className="font-semibold">单 agent 时间线</h3>
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

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="plans-panel">
          <h3 className="font-semibold">套餐管理 · ops</h3>
          {planErr && <div className="text-xs text-amber-600 dark:text-amber-400">{planErr}</div>}
          <form onSubmit={savePlan} className="flex gap-2 items-center flex-wrap">
            <input
              value={planDraft.email}
              onChange={(e) => setPlanDraft({ ...planDraft, email: e.target.value })}
              placeholder="调用者邮箱（sub2api 账户）"
              className="w-56 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
            <input
              value={planDraft.limit}
              onChange={(e) => setPlanDraft({ ...planDraft, limit: e.target.value })}
              inputMode="numeric"
              placeholder="分钟上限"
              className="w-28 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
            />
            <input
              value={planDraft.note}
              onChange={(e) => setPlanDraft({ ...planDraft, note: e.target.value })}
              placeholder="备注（可选）"
              className="w-40 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
            <button disabled={planBusy} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs disabled:opacity-40">
              {planBusy ? "保存中…" : "发放/调整"}
            </button>
          </form>
          {plans && plans.plans.length > 0 && (
            <div className="text-xs space-y-1" data-testid="plans-list">
              {plans.plans.map((p) => (
                <div key={p.planRef} className="flex gap-3">
                  <span className="font-mono text-slate-400 w-8">{p.userId}</span>
                  <span className="w-56 truncate">{p.email || "—"}</span>
                  <span>上限 {p.limitMinutes} · 已用 {p.usedMinutes} · 剩余 <b>{p.remainingMinutes}</b></span>
                  {p.note ? <span className="text-slate-400">「{p.note}」</span> : null}
                </div>
              ))}
            </div>
          )}
          {plans && plans.plans.length === 0 && <div className="text-xs text-slate-400">尚无套餐。</div>}
          <div className="text-[10px] text-slate-400">套餐是调用者侧的预付分钟包：API 回合按分钟实扣套餐余量，扣完下回合拒、调整即恢复；无套餐的调用者仍按调用键余额结算。</div>
        </div>
      </div>
    </div>
  );
}
