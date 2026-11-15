// 运维面 (refactor-console-ia, M4④ 前置): the ops surfaces — the fleet board
// (30s poll while this tab is shown), the per-agent timeline drill-down, the
// ops plan manager, and the plan-request queue it adjudicates
// (add-plan-requests-and-move-statement). Moved verbatim from the ConsoleView
// monolith; the ops token's management gate is unchanged (logged-in
// identities read).
import { useEffect, useState } from "react";
import { authFetch } from "../../auth.js";
import { fmtAgo, fmtMs, planRequestBadge, fmtSpan, healthCauseLabel } from "./shared.jsx";
import { SkeletonLines, SkeletonCards } from "../../components/Skeleton.jsx";

const fmtWhen = (ms) => (ms ? new Date(Number(ms)).toLocaleString("zh-CN", { hour12: false }) : "");

// Runner lifecycle vocabulary (unify-wanxing-surface-language D4). Deliberately
// its OWN words, not the agent status badges: this row answers "who is running
// right now", while the badges answer "is this agent healthy". Sharing labels
// would conflate the two.
export const RUNNER_STATE_LABEL = {
  serving: "在役",
  resident: "常驻",
  paused: "已暂停",
  starting: "启动中",
  draining: "退出中",
  warm: "预热",
  unknown: "未知",
};

export function OpsView() {
  const [board, setBoard] = useState(null);
  const [boardErr, setBoardErr] = useState(null);
  const [agent, setAgent] = useState("");
  const [timeline, setTimeline] = useState(null);
  const [tlErr, setTlErr] = useState(null);
  // Ops plan manager (add-serving-plans).
  const [plans, setPlans] = useState(null);
  const [planErr, setPlanErr] = useState("");
  // Ops-panel visibility (wanxing-first-visitor 5.1): the plans list doubles
  // as the ops-role probe — 403 means "not ops", and the two ops-only panels
  // (queue + management) stay hidden instead of rendering into guaranteed
  // 403 error text. null = probe in flight.
  const [opsOk, setOpsOk] = useState(null);
  const [planDraft, setPlanDraft] = useState({ email: "", limit: "", note: "" });
  const [planBusy, setPlanBusy] = useState(false);
  // Plan-request queue (add-plan-requests-and-move-statement 2.3): loaded
  // only once the plans list proved the ops credential — a logged-in
  // identity would get its OWN rows back from the same GET, and a queue
  // whose buttons can only 403 is worse than none.
  const [queue, setQueue] = useState(null); // { requests, pending }
  const [queueErr, setQueueErr] = useState("");
  const [qNotes, setQNotes] = useState({}); // ref → decision note draft
  const [qBusy, setQBusy] = useState(""); // ref in flight
  // Line copilot bindings (unify-cross-line-copilot 3.1).
  const [lineCopilots, setLineCopilots] = useState(null); // null = not loaded / not ops
  const [lineErr, setLineErr] = useState("");
  const [lineBusy, setLineBusy] = useState(false);
  const [unbindArm, setUnbindArm] = useState(null); // line awaiting the second click
  const [lineDraft, setLineDraft] = useState({ line: "", agentSlug: "", accent: "", anonymous: false });

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

  // 壹座舰队镜像 (add-fleet-cockpit-projection): read-only projection from the
  // paas cell sampler's second lane. An observer that predates the read face
  // (404) or an empty mirror HIDES the whole section — never render stale-or-
  // absent as live; decommissioning is as quiet as the endpoint disappearing.
  const [mirror, setMirror] = useState(null); // null = hide section
  useEffect(() => {
    let live = true;
    const load = () =>
      authFetch("/api/fleet/v1/cell-fleets")
        .then(async (r) => {
          if (!r.ok) throw new Error(`cell-fleets HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => live && setMirror(typeof d?.cells === "object" && d.cells !== null ? d.cells : {}))
        .catch(() => live && setMirror(null));
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

  const loadQueue = () =>
    authFetch("/api/wanxing/v1/console/plan-requests")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (setQueue(d), setQueueErr("")))
      .catch((e) => setQueueErr(String(e?.message || e)));

  const loadPlans = () =>
    authFetch("/api/wanxing/v1/console/plans")
      .then(async (r) => {
        if (r.status === 403) { setOpsOk(false); setPlanErr(""); return; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setOpsOk(true);
        return r.json();
      })
      .then((d) => { if (d) { setPlans(d); setPlanErr(""); loadQueue(); loadLineCopilots(); } })
      .catch((e) => setPlanErr(String(e?.message || e)));

  // ── Line copilot bindings (unify-cross-line-copilot 3.1) ─────────────────
  // Ops-only governance list. Every row shows INTENT (what the line asked for)
  // next to EFFECT (what the gates currently do) — an unopened anonymous gate
  // must read as a visible configuration gap, not a silent trap for visitors.
  const loadLineCopilots = () =>
    authFetch("/api/wanxing/v1/console/line-copilots")
      .then(async (r) => {
        if (r.status === 403) { setLineCopilots(null); return; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { if (d) { setLineCopilots(d.bindings ?? []); setLineErr(""); } })
      .catch((e) => setLineErr(String(e?.message || e)));

  const saveLineBinding = async (e) => {
    e.preventDefault();
    const line = lineDraft.line.trim().toLowerCase();
    const agentSlug = lineDraft.agentSlug.trim();
    if (!line || !agentSlug) { setLineErr("线 id 与部署 slug 都要填"); return; }
    setLineBusy(true);
    setLineErr("");
    try {
      const r = await authFetch(`/api/wanxing/v1/console/line-copilots/${encodeURIComponent(line)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug,
          accent: lineDraft.accent.trim(),
          anonymousIntent: lineDraft.anonymous,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error?.message || d?.error || `HTTP ${r.status}`);
      setLineDraft({ line: "", agentSlug: "", accent: "", anonymous: false });
      await loadLineCopilots();
    } catch (err) {
      setLineErr(String(err?.message || err));
    } finally {
      setLineBusy(false);
    }
  };

  const unbindLine = async (line) => {
    if (unbindArm !== line) { setUnbindArm(line); return; }
    setUnbindArm(null);
    setLineBusy(true);
    try {
      const r = await authFetch(`/api/wanxing/v1/console/line-copilots/${encodeURIComponent(line)}`, { method: "DELETE" });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error?.message || d?.error || `HTTP ${r.status}`);
      await loadLineCopilots();
    } catch (err) {
      setLineErr(String(err?.message || err));
    } finally {
      setLineBusy(false);
    }
  };

  useEffect(() => {
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adjudicate one request; a success reloads BOTH lists (approval lands as
  // a plan row below). The error reads at the queue, next to the buttons.
  const decideRequest = async (ref, status) => {
    setQBusy(ref);
    try {
      const r = await authFetch(`/api/wanxing/v1/console/plan-requests/${encodeURIComponent(ref)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: qNotes[ref] || "" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setQNotes((p) => {
        const next = { ...p };
        delete next[ref];
        return next;
      });
      setQueueErr("");
      await loadPlans();
    } catch (err) {
      setQueueErr(String(err?.message || err));
    } finally {
      setQBusy("");
    }
  };

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
  // 存活判定 (add-agent-led-multi-host-lease 2.x): board.runners 只是"最近 30 分钟说过话
  // 的快照"，机器一停键就消失，界面上"安静"和"死了"长得一样。liveness 直接回答
  // "上次听到它是什么时候"，三态 ok/stale/lost；缺失=observer 未升级，要说明而不是当正常。
  const liveness = board?.runner_liveness ?? null;
  const liveOf = (id) => (liveness ? liveness[id] ?? null : null);
  const presenceCls = (p) =>
    p === "ok" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : p === "stale" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : p === "lost" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  const presenceLabel = (p) => (p === "ok" ? "在线" : p === "stale" ? "迟报" : p === "lost" ? "失联" : "未知");
  // 失联的 runner 已经从 30 分钟快照里掉出去了——那正是它们最需要被看见的时候，
  // 所以先把 liveness 里没进快照的补进列表，否则"掉线"反而在界面上消失。
  const silentOnly = Object.keys(liveness ?? {}).filter((id) => !(id in (board?.runners ?? {})));
  const lag = board?.ingest_lag ?? [];
  const pending = board?.settled_pending ?? {};
  const wake = board?.wake_ms ?? {};
  // 短期执行 (add-fleet-cell-views): cell 遥测段——board.cells 缺席=observer 未升级。
  const cells = Object.entries(board?.cells ?? {});
  const st = board?.shortterm ?? null;
  const queueRows = queue?.requests ?? [];
  const pendingRows = queueRows.filter((r) => r.status === "pending");
  const decidedRows = queueRows.filter((r) => r.status !== "pending");
  const qInputCls = "px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs";

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
              <span
                key={k}
                className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800"
                title={`runner 生命周期状态：${k}（与目录的 agent 状态不是同一套词汇）`}
              >
                {RUNNER_STATE_LABEL[k] ?? k} <b>{Number(v)}</b>
              </span>
            ))}
            {st && (
              <span className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800">
                短期在跑 <b>{st.running}</b> · 排队 <b>{st.queued}</b> · cells <b>{st.cells}</b>
              </span>
            )}
          </div>
          {/* 口径脚注（D4）：板的 agents_total 是「窗口内被观测到的」，页脚状态条是「公开目录在役数」。
              两个数字不相等是正常的，界面上不解释就等于让读者以为数据错了。 */}
          <p className="text-[11px] text-slate-400 -mt-1" data-testid="ops-scope-note">
            此处统计<b>窗口内被观测到</b>的 agent（{board.window ?? "24h"}）；页脚「N 个 agent 在役」是公开目录口径。
            两者范围不同——数字不相等不是故障。悬停任一状态可读原始枚举值。
          </p>
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
              {!liveness && runners.length === 0 && <div className="text-slate-500">窗口内无 runner_stats——runner 尚未上报，或上报停在了窗口外。runner 一上报就会出现在这里（观测面 30s 自动刷新）。</div>}
              {liveness === null && runners.length > 0 && (
                <div className="text-xs text-slate-500">存活判定不可用（observer 未升级）</div>
              )}
              {runners.map(([id, s]) => {
                const lv = liveOf(id);
                return (
                  <div key={id} className="font-mono text-xs">
                    {id}{s.pod ? <span className="ml-1 px-1 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" title="pod 共宿模式（密度档）">pod</span> : null}
                    {lv && (
                      <span className={`ml-1 px-1 rounded ${presenceCls(lv.presence)}`} title={`最后一拍 ${fmtAgo(lv.age_ms)} 前 · 窗口内 ${lv.beats ?? 0} 拍`}>
                        {presenceLabel(lv.presence)} {fmtAgo(lv.age_ms)}
                      </span>
                    )}
                    {" "}— child {s.children ?? "?"}/{s.agents ?? "?"} · {Math.round(s.budget_mb ?? 0)}/{s.budget_mb_limit ?? "?"}MB{Number(s.queued) > 0 ? ` · 排队 ${s.queued}` : ""}
                  </div>
                );
              })}
              {silentOnly.map((id) => {
                const lv = liveOf(id);
                return (
                  <div key={id} className="font-mono text-xs">
                    {id}
                    <span className={`ml-1 px-1 rounded ${presenceCls(lv.presence)}`} title={`最后一拍 ${fmtAgo(lv.age_ms)} 前 · 窗口内 ${lv.beats ?? 0} 拍`}>
                      {presenceLabel(lv.presence)} {fmtAgo(lv.age_ms)}
                    </span>
                    <span className="text-slate-500 ml-1">已脱离 30m 快照</span>
                  </div>
                );
              })}
              <div className="font-semibold pt-2">任务（24h）</div>
              {board.missions === undefined && <div className="text-slate-500">暂无数据（observer 未升级）</div>}
              {board.missions?.length === 0 && <div className="text-slate-500">窗口内无任务——本窗口没有任务被提交或推进；任务由「我的任务」提交，提交后这里按 24h 窗口显示。</div>}
              {(board.missions ?? []).slice(0, 8).map((m) => (
                <div key={m.id} className="text-xs flex gap-2 items-center">
                  <span className={`px-1.5 rounded font-mono ${m.status === "reported" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : m.status === "failed" || m.status === "aborted" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>{m.status}</span>
                  <span className="font-mono text-slate-400">{(m.id || "").slice(0, 12)}</span>
                  <span className="truncate">{m.owner || "—"}</span>
                  {m.spent != null && <span>{m.spent} 分钟</span>}
                </div>
              ))}
              <div className="font-semibold pt-2">工作租约</div>
              {!board.leases ? (
                <div className="text-slate-500">租约读取面不可用（observer 未升级）</div>
              ) : !board.leases.available ? (
                // 空流 ≠ 健康流：没有发送方时明说，不渲染成"没有卡住的租约"。
                <div className="text-slate-500">无租约事件（发送方尚未上线）</div>
              ) : (
                <>
                  <div className="text-xs">
                    在持 <b>{board.leases.active}</b> · 窗口内过期 <b className={board.leases.expired_in_window > 0 ? "text-rose-600 dark:text-rose-400" : ""}>{board.leases.expired_in_window}</b>
                  </div>
                  {(board.leases.units ?? []).slice(0, 5).map((u) => (
                    <div key={u.unit} className="font-mono text-xs flex gap-2 items-center">
                      <span className={`px-1.5 rounded ${u.state === "expired" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>{u.state}</span>
                      <span className="truncate">{u.unit}</span>
                      {u.holder && <span className="text-slate-400 truncate">{u.holder}</span>}
                      <span className="text-slate-400">{fmtAgo(u.age_ms)}</span>
                    </div>
                  ))}
                </>
              )}
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
        <SkeletonCards cards={2} />
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
        {board?.cells === undefined && <div className="text-slate-500">此段不可用（observer 未升级到携带 cells）——升级 observer 后自动出现，无需前端改动。</div>}
        {board?.cells !== undefined && cells.length === 0 && <div className="text-slate-500">窗口内无 cell 遥测——通常意味着 gateway 未配置 FLEET_INGEST_URL，或窗口内没有 cell 上报。</div>}
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

      {mirror && Object.keys(mirror).length > 0 && (
        <div
          className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm space-y-3"
          data-testid="fleet-mirror-section"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">壹座舰队镜像 <span className="text-xs font-normal text-slate-400">（30s/60s 采样只读 · 动作回壹座驾驶舱）</span></div>
          </div>
          {Object.entries(mirror).map(([cellId, c]) => (
            <div key={cellId} className="rounded-lg border border-slate-100 dark:border-slate-900 p-3 space-y-2">
              <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 items-baseline">
                <span className="font-mono truncate max-w-72" title={cellId}>{cellId.replace(/^cell:/, "")}</span>
                <span>样龄 {fmtAgo(Number(c.ageMs ?? 0))}</span>
                {c.stale && (
                  <span className="px-1.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" data-testid="fleet-mirror-stale">样龄超限（快照超过 3×tick）</span>
                )}
              </div>
              {(c.fleets ?? []).map((f) => (
                <div key={f.id} className="space-y-1.5 pb-2 border-b border-slate-100 dark:border-slate-900 last:border-b-0" data-testid={`fleet-mirror-fleet-${f.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      className="font-medium underline decoration-dotted underline-offset-4"
                      href={`https://platform.finddatatech.cloud/fleets/${encodeURIComponent(f.id)}`}
                      target="_blank" rel="noreferrer"
                      data-testid="fleet-mirror-link"
                    >
                      {f.name}
                    </a>
                    <span className="text-xs px-1.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 font-mono">{f.state}</span>
                    {Object.entries(f.counts ?? {})
                      .filter(([k, v]) => ((k === "onDuty" || k === "missing" || k === "failing" || k === "vacant" || k === "passive" || k === "paused") && Number(v) > 0) || k === "total")
                      .map(([k, v]) => (
                        <span key={k} className={`text-xs px-1.5 rounded-full ${k === "missing" || k === "failing" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                          {k} {Number(v)}
                        </span>
                      ))}
                    {Number(f.openDecisions?.count ?? 0) > 0 && (
                      <span className="text-xs px-1.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" data-testid="fleet-mirror-decisions">
                        待拍板 {f.openDecisions.count} 件
                      </span>
                    )}
                  </div>
                  {(f.openDecisions?.top ?? []).map((d, i) => (
                    <div key={i} className="text-xs flex flex-wrap gap-x-2 items-baseline text-slate-600 dark:text-slate-300">
                      <span className={`px-1 rounded font-mono ${d.severity === "high" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{d.severity}</span>
                      <span className="truncate">{d.question}</span>
                      {d.memberTitle && <span className="text-slate-400">@{d.memberTitle}</span>}
                      {d.expiresAt && <span className="text-slate-400">{fmtWhen(d.expiresAt)} 过期</span>}
                    </div>
                  ))}
                  {(f.stream ?? []).map((s, i) => (
                    <div key={i} className="text-xs flex flex-wrap gap-x-2 items-baseline text-slate-500">
                      <span className="text-slate-400">{s.title}</span>
                      <span className={`px-1 rounded font-mono ${s.status === "on_duty" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : s.status === "missing" || s.status === "failing" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{s.status}</span>
                      {s.at && <span>{fmtWhen(s.at)}</span>}
                      {s.source && <span className="text-slate-400">[{s.source}]</span>}
                      {s.summarySnip && <span className="truncate">{s.summarySnip}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
        <h3 className="font-semibold">单 agent 时间线</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTimeline(null);
          }}
          className="flex gap-2"
        >
          <input aria-label="agent slug"
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

        {opsOk !== false && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="plan-requests-queue">
          <h3 className="font-semibold">
            套餐申请 · 待审
            {queue && (
              <span
                className={`ml-2 text-xs font-normal px-2 py-0.5 rounded-full ${queue.pending > 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}
                data-testid="plan-requests-pending-count"
              >
                {queue.pending} 待审
              </span>
            )}
          </h3>
          {queueErr && <div className="text-xs text-amber-600 dark:text-amber-400" data-testid="plan-requests-queue-error">{queueErr}</div>}
          {!queue && !queueErr && <div className="text-xs text-slate-400">{planErr ? "审批面加载失败。" : <SkeletonLines rows={2} />}</div>}
          {queue && pendingRows.length === 0 && <div className="text-xs text-slate-400">没有待审申请。</div>}
          {pendingRows.map((r) => (
            <div key={r.ref} className="text-xs flex gap-2 items-center flex-wrap border-t border-slate-100 dark:border-slate-800 pt-2" data-testid="plan-request-queue-row" data-ref={r.ref}>
              <span className="w-52 truncate" title={r.email}>{r.email || "—"}</span>
              <span>申请 <b>{r.limitMinutes}</b> 分钟</span>
              {r.note ? <span className="text-slate-400">「{r.note}」</span> : null}
              <span className="text-slate-400">{fmtWhen(r.createdAt)}</span>
              <input aria-label="审批备注（可选）"
                value={qNotes[r.ref] ?? ""}
                onChange={(e) => setQNotes({ ...qNotes, [r.ref]: e.target.value })}
                maxLength={200}
                placeholder="审批备注（可选）"
                className={`w-40 ${qInputCls}`}
                data-testid="plan-request-decide-note"
              />
              <button
                disabled={qBusy === r.ref}
                onClick={() => decideRequest(r.ref, "approved")}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white disabled:opacity-40"
                data-testid="plan-request-approve"
              >
                {qBusy === r.ref ? "处理中…" : "批准"}
              </button>
              <button
                disabled={qBusy === r.ref}
                onClick={() => decideRequest(r.ref, "rejected")}
                className="px-2.5 py-1 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 disabled:opacity-40"
                data-testid="plan-request-reject"
              >
                驳回
              </button>
            </div>
          ))}
          {decidedRows.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer select-none text-slate-500">最近已处理（{decidedRows.length}）</summary>
              <div className="pt-1 space-y-1" data-testid="plan-requests-decided">
                {decidedRows.slice(0, 20).map((r) => (
                  <div key={r.ref} className="flex gap-2 items-center flex-wrap" data-ref={r.ref} data-status={r.status}>
                    {planRequestBadge(r.status)}
                    <span className="w-52 truncate" title={r.email}>{r.email || "—"}</span>
                    <span>{r.limitMinutes} 分钟</span>
                    {r.decidedNote ? <span className="text-slate-400">「{r.decidedNote}」</span> : null}
                    <span className="text-slate-400">{fmtWhen(r.decidedAt)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="text-[11px] text-slate-400">批准=经套餐发放路径落上限（与下方手动发放是同一条路，列表随即出现/更新）；驳回只记录备注、不发放。</div>
        </div>
        )}

        {board && Array.isArray(board.agent_health) && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="unhealthy-agents-panel">
          <h3 className="font-semibold">不健康 agent · 机群</h3>
          {(() => {
            // flag-stalled-rhythm-agents 3.2: stalled agents belong on this list
            // too — "declared a rhythm, ran zero turns" is exactly the silent
            // failure this panel exists to surface.
            const bad = board.agent_health.filter((h) => h.health === "failing" || h.health === "degraded" || h.stalled === true);
            if (bad.length === 0) {
              return <div className="text-xs text-slate-500" data-testid="unhealthy-empty">当前没有持续失败、部分失败或该跑没跑的 agent。</div>;
            }
            return (
              <div className="space-y-1.5" data-testid="unhealthy-list">
                {bad.map((h) => (
                  <div key={h.agent} className="flex gap-3 items-center flex-wrap text-xs" data-agent={h.agent} data-health={h.health}>
                    <span className={`px-1.5 py-0.5 rounded text-[11px] ${h.health === "failing" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : h.stalled === true ? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
                      {h.health === "failing" ? "持续失败" : h.stalled === true ? "该跑没跑" : "部分失败"}
                    </span>
                    <span className="font-mono truncate max-w-[22rem]" title={h.agent}>{h.agent}</span>
                    <span className="text-slate-500">{h.since != null ? `已 ${fmtSpan(Date.now() - h.since)}` : "—"}</span>
                    <span className="text-slate-500">{h.consecutive ? `连续 ${h.consecutive} 回合` : `${h.errors}/${h.turns} 回合失败`}</span>
                    <span className="text-slate-500">{h.lastErrorKind ? healthCauseLabel(h.lastErrorKind) : "—"}</span>
                    <a className="ml-auto underline text-slate-500" href={`#/chat/${encodeURIComponent(h.agent)}`}>看这个 agent →</a>
                  </div>
                ))}
              </div>
            );
          })()}
          <div className="text-[11px] text-slate-400">
            判据：窗口内全失败且连续失败量达到阈值＝持续失败；有成功也有失败且失败率超阈值＝部分失败。
            暂停中的 agent 不计入；零回合的标「无流量」而不是故障。
          </div>
        </div>
        )}

        {opsOk !== false && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="plans-panel">
          <h3 className="font-semibold">套餐管理 · ops</h3>
          {planErr && <div className="text-xs text-amber-600 dark:text-amber-400">{planErr}</div>}
          <form onSubmit={savePlan} className="flex gap-2 items-center flex-wrap">
            <input aria-label="调用者邮箱"
              value={planDraft.email}
              onChange={(e) => setPlanDraft({ ...planDraft, email: e.target.value })}
              placeholder="调用者邮箱（sub2api 账户）"
              className="w-56 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
            <input aria-label="分钟上限"
              value={planDraft.limit}
              onChange={(e) => setPlanDraft({ ...planDraft, limit: e.target.value })}
              inputMode="numeric"
              placeholder="分钟上限"
              className="w-28 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
            />
            <input aria-label="备注（可选）"
              value={planDraft.note}
              onChange={(e) => setPlanDraft({ ...planDraft, note: e.target.value })}
              placeholder="备注（可选）"
              className="w-40 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
            <button disabled={planBusy} className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-40">
              {planBusy ? "保存中…" : "发放/调整"}
            </button>
          </form>
          {plans && (plans.plans ?? []).length > 0 && (
            <div className="text-xs space-y-1" data-testid="plans-list">
              {(plans.plans ?? []).map((p) => (
                <div key={p.planRef} className="flex gap-3">
                  <span className="font-mono text-slate-400 w-8">{p.userId}</span>
                  <span className="w-56 truncate">{p.email || "—"}</span>
                  <span>上限 {p.limitMinutes} · 已用 {p.usedMinutes} · 剩余 <b>{p.remainingMinutes}</b></span>
                  {p.note ? <span className="text-slate-400">「{p.note}」</span> : null}
                </div>
              ))}
            </div>
          )}
          {plans && (plans.plans ?? []).length === 0 && <div className="text-xs text-slate-400">尚无套餐。</div>}
          <div className="text-[11px] text-slate-400">套餐是调用者侧的预付分钟包：API 回合按分钟实扣套餐余量，扣完下回合拒、调整即恢复；无套餐的调用者仍按调用键余额结算。</div>
        </div>
        )}

        {opsOk !== false && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="line-copilots-panel">
          <h3 className="font-semibold">线副驾绑定 · ops</h3>
          <div className="text-[11px] text-slate-400">
            一条线对外用哪个助手，是这里的治理记录——产品线页面只要挂一个 <span className="font-mono">copilot.js</span> 标签，
            副驾就按这里解析。绑定写的是<b>意图</b>，生效仍看现有的两道闸。
          </div>
          {lineErr && <div className="text-xs text-amber-600 dark:text-amber-400">{lineErr}</div>}

          {lineCopilots && lineCopilots.length > 0 && (
            <div className="space-y-1.5" data-testid="line-copilots-list">
              {lineCopilots.map((b) => (
                <div key={b.line} className="flex gap-3 items-center flex-wrap text-xs" data-line={b.line} data-state={b.state}>
                  <span className="font-mono w-20 truncate" title={b.line}>{b.line}</span>
                  <span className="w-56 truncate" title={b.agentSlug}>{b.agentName || b.agentSlug}</span>
                  {b.accent ? (
                    <span
                      className="inline-block w-3 h-3 rounded-sm border border-slate-300 dark:border-slate-600"
                      style={{ background: b.accent }}
                      title={`线配色 ${b.accent}`}
                    />
                  ) : null}
                  <span className="text-slate-400">意图 {b.anonymousIntent ? "匿名开" : "匿名关"}</span>
                  <span
                    className={
                      b.effective === "open"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : b.effective === "login_required"
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-slate-500"
                    }
                    data-testid={`line-effective-${b.line}`}
                  >
                    生效 {b.effective === "open" ? "匿名可聊" : b.effective === "login_required" ? "需登录" : `不可用${b.reason ? `（${b.reason}）` : ""}`}
                  </span>
                  {b.gap && (
                    <span
                      className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      data-testid={`line-gap-${b.line}`}
                      title="意图与生效不一致：访客不会得到匿名对话"
                    >
                      缺口 · 匿名未开
                    </span>
                  )}
                  <button
                    onClick={() => unbindLine(b.line)}
                    disabled={lineBusy}
                    className={`ml-auto px-2 py-1 rounded border text-xs disabled:opacity-40 ${
                      unbindArm === b.line
                        ? "border-amber-400 text-amber-700 dark:text-amber-400"
                        : "border-slate-300 dark:border-slate-700"
                    }`}
                    data-testid={`line-unbind-${b.line}`}
                  >
                    {unbindArm === b.line ? "确认解绑？" : "解绑"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {lineCopilots && lineCopilots.length === 0 && (
            <div className="text-xs text-slate-400">尚无绑定——没有线会挂上副驾。</div>
          )}

          <form onSubmit={saveLineBinding} className="flex gap-2 items-center flex-wrap pt-1 border-t border-slate-200 dark:border-slate-800">
            <input aria-label="线 id"
              value={lineDraft.line}
              onChange={(e) => setLineDraft({ ...lineDraft, line: e.target.value })}
              placeholder="线 id（如 lex）"
              className="w-32 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
            />
            <input aria-label="部署 slug"
              value={lineDraft.agentSlug}
              onChange={(e) => setLineDraft({ ...lineDraft, agentSlug: e.target.value })}
              placeholder="公开部署 slug"
              className="w-80 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
            />
            <input aria-label="线配色"
              value={lineDraft.accent}
              onChange={(e) => setLineDraft({ ...lineDraft, accent: e.target.value })}
              placeholder="#1d4ed8（可选）"
              className="w-32 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
            />
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={lineDraft.anonymous}
                onChange={(e) => setLineDraft({ ...lineDraft, anonymous: e.target.checked })}
                data-testid="line-anon-intent"
              />
              意图允许匿名
            </label>
            <button disabled={lineBusy} className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-40">
              {lineBusy ? "保存中…" : "绑定/更新"}
            </button>
          </form>

          <div className="text-[11px] text-slate-400">
            出现「缺口」意味着：这条线想看匿名对话，但该部署的匿名开关（或平台匿名总开关）没开——访客点开助手只会看到「登录后开始对话」。
            去<b>该部署的「嵌入」面板</b>打开「允许匿名访客」即可；两道闸都开之后，这一行会变成「生效 匿名可聊」，缺口消失。
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
