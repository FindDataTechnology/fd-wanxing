// 消耗视图 (add-stats-plane-v1 4.x): three calibers side by side — fleet
// (estimated), sub2api (billed), local (estimated). The server never merges
// calibers and neither does this view; every figure block carries its label.
// The caller-side statement card (API 调用对账) sits above the calibers
// (add-plan-requests-and-move-statement): caller economics live where
// consumption is read, and the plan-request form rides inside that card.

import { useEffect, useState } from "react";
import { authFetch } from "../../auth.js";
import { DailyChart } from "../../components/DailyChart.jsx";
import { planRequestBadge } from "./shared.jsx";

const DAY_CHOICES = [1, 7, 30, 90];
const PAGE_SIZE = 10;
// Plan-request range mirrors the facade gate (console.js PLAN_REQUEST_*);
// the three tiers are suggestions only — any integer in range is accepted.
const PLAN_REQUEST_MIN = 60;
const PLAN_REQUEST_MAX = 1_000_000;
const PLAN_SUGGESTIONS = [500, 2000, 10000];
const fmtWhen = (ms) => (ms ? new Date(Number(ms)).toLocaleString("zh-CN", { hour12: false }) : "");

// Agent ids are `packs-<packId>` slugs, so the raw string spends its first six
// characters repeating the same prefix on every row — truncating at a fixed
// width then leaves every row looking identical ("packs-i262i0tuwtf9…"), which
// is the "can't tell them apart" problem this table had. Stripping the known
// prefix is what makes the distinguishing part land inside the column.
const agentLabel = (agent) => String(agent ?? "").replace(/^packs-/, "");

const fmtTok = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return String(v);
};

// Paged table footer: the view used to render `rows.slice(0, 20)` and silently
// drop the rest, so a busy fleet looked complete while data was missing.
function Pager({ page, setPage, total, testid }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) {
    return <div className="mt-1 text-[11px] text-slate-400" data-testid={`${testid}-count`}>共 {total} 项</div>;
  }
  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500" data-testid={`${testid}-pager`}>
      <span data-testid={`${testid}-count`}>共 {total} 项 · 第 {page + 1}/{pages} 页</span>
      <button
        onClick={() => setPage(Math.max(0, page - 1))}
        disabled={page === 0}
        className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40"
        data-testid={`${testid}-prev`}
      >
        上一页
      </button>
      <button
        onClick={() => setPage(Math.min(pages - 1, page + 1))}
        disabled={page >= pages - 1}
        className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40"
        data-testid={`${testid}-next`}
      >
        下一页
      </button>
    </div>
  );
}

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

// API 调用对账 (add-serving-plans 4.1, moved here by
// add-plan-requests-and-move-statement): the signed-in caller's own
// statement — identity-scoped on the server, this fetch can only ever read
// the caller's own rows — plus the plan-request form and the caller's own
// request list. The request face only opens once the statement resolved an
// identity: the ops token (403 here) has nobody to request for, and a
// billing-plane outage would fail the POST the same way it failed the read.
function StatementCard() {
  const [stmt, setStmt] = useState(null);
  const [stmtErr, setStmtErr] = useState("");
  const [reqs, setReqs] = useState(null);
  const [reqErr, setReqErr] = useState("");
  const [draft, setDraft] = useState({ limit: "", note: "" });
  const [reqBusy, setReqBusy] = useState(false);
  const [reqNote, setReqNote] = useState("");

  const loadRequests = () =>
    authFetch("/api/wanxing/v1/console/plan-requests")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (setReqs(d.requests ?? []), setReqErr("")))
      .catch((e) => setReqErr(String(e?.message || e)));

  useEffect(() => {
    let live = true;
    authFetch("/api/wanxing/v1/console/my/statement")
      .then(async (r) => {
        if (r.status === 403) throw new Error("ops 令牌没有身份——套餐对账请用登录身份查看");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!live) return;
        setStmt(d);
        setStmtErr("");
        loadRequests();
      })
      .catch((e) => live && setStmtErr(String(e?.message || e)));
    return () => {
      live = false;
    };
  }, []);

  const submitRequest = async (e) => {
    e.preventDefault();
    const limit = Number(draft.limit);
    if (!Number.isInteger(limit) || limit < PLAN_REQUEST_MIN || limit > PLAN_REQUEST_MAX) {
      setReqNote(`分钟上限须为 ${PLAN_REQUEST_MIN}–${PLAN_REQUEST_MAX} 的整数`);
      return;
    }
    setReqBusy(true);
    setReqNote("");
    try {
      const r = await authFetch("/api/wanxing/v1/console/plan-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitMinutes: limit, note: draft.note }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDraft({ limit: "", note: "" });
      setReqNote("已提交——运维批准后套餐自动生效，进度见下方「我的申请」。");
      await loadRequests();
    } catch (err) {
      setReqNote(String(err?.message || err));
    } finally {
      setReqBusy(false);
    }
  };

  const inputCls = "px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs";
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="my-statement-panel">
      <h3 className="font-semibold">API 调用对账</h3>
      <div className="text-[11px] text-slate-400">即原「我的套餐」——你作为 API 调用方的对账单：套餐是平台发放的包月额度（找运维开通），无套餐时按调用键余额逐分钟实扣。</div>
      {stmtErr && <div className="text-xs text-amber-600 dark:text-amber-400">{stmtErr}</div>}
      {stmt && (
        <div className="text-xs text-slate-500 space-y-1" data-testid="my-statement-body">
          {stmt.plan ? (
            <div>
              套餐上限 <b>{stmt.plan.limitMinutes}</b> 分钟 · 已用 <b>{stmt.plan.usedMinutes}</b> · 剩余 <b className="text-slate-900 dark:text-slate-100">{stmt.plan.remainingMinutes}</b>
            </div>
          ) : (
            <div>暂无套餐——API 调用按调用键余额计费。</div>
          )}
          <div>
            套餐结算 <b>{stmt.usage?.planMinutes ?? 0}</b> 分钟（{stmt.usage?.planTurns ?? 0} 回合） · 余额路径 <b>{stmt.usage?.legacyMinutes ?? 0}</b> 分钟（{stmt.usage?.legacyTurns ?? 0} 回合）
          </div>
        </div>
      )}
      {stmt && (
        <div className="border-t border-slate-200 dark:border-slate-800 pt-2 space-y-2 text-xs" data-testid="plan-request-section">
          <details data-testid="plan-request-toggle">
            <summary className="cursor-pointer select-none font-semibold">{stmt.plan ? "申请调整套餐" : "申请套餐"}</summary>
            <form onSubmit={submitRequest} className="pt-2 space-y-2">
              <div className="flex gap-1 flex-wrap items-center">
                <span className="text-slate-500">建议档：</span>
                {PLAN_SUGGESTIONS.map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => setDraft({ ...draft, limit: String(n) })}
                    className={`px-2 py-0.5 rounded-full border ${String(n) === draft.limit ? "bg-accent text-white border-transparent" : "border-slate-300 dark:border-slate-700 text-slate-500"}`}
                    data-testid={`plan-request-suggest-${n}`}
                  >
                    {n} 分钟
                  </button>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <input aria-label="自定义分钟上限"
                  value={draft.limit}
                  onChange={(e) => setDraft({ ...draft, limit: e.target.value })}
                  inputMode="numeric"
                  placeholder="或自定义分钟上限"
                  className={`w-36 font-mono ${inputCls}`}
                  data-testid="plan-request-limit"
                />
                <input aria-label="申请备注（可选）"
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  maxLength={200}
                  placeholder="备注：用途/预期（可选）"
                  className={`w-64 ${inputCls}`}
                  data-testid="plan-request-note"
                />
                <button
                  disabled={reqBusy}
                  className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-40"
                  data-testid="plan-request-submit"
                >
                  {reqBusy ? "提交中…" : "提交申请"}
                </button>
              </div>
              {reqNote && <div className="text-amber-600 dark:text-amber-400" data-testid="plan-request-feedback">{reqNote}</div>}
              <div className="text-[11px] text-slate-400">申请只是把「找运维开通」搬进控制台：由运维审批、批准即经发放路径生效，不从调用键余额扣款；范围 {PLAN_REQUEST_MIN}–{PLAN_REQUEST_MAX} 分钟，有未决申请时也可再提。</div>
            </form>
          </details>
          <div className="space-y-1" data-testid="plan-requests-mine">
            <div className="font-semibold">我的申请</div>
            {reqErr && <div className="text-amber-600 dark:text-amber-400">申请列表读取失败（{reqErr}）</div>}
            {reqs && reqs.length === 0 && <div className="text-slate-400">暂无申请。</div>}
            {(reqs ?? []).map((r) => (
              <div key={r.ref} className="flex gap-2 items-center flex-wrap" data-testid="plan-request-row" data-status={r.status} data-ref={r.ref}>
                {planRequestBadge(r.status)}
                <span><b>{r.limitMinutes}</b> 分钟</span>
                {r.note ? <span className="text-slate-400">「{r.note}」</span> : null}
                <span className="text-slate-400">{fmtWhen(r.createdAt)}</span>
                {r.status !== "pending" && r.decidedNote ? <span className="text-slate-500">审批备注：{r.decidedNote}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}
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
  const [agentPage, setAgentPage] = useState(0);
  const [modelPage, setModelPage] = useState(0);

  // A new window is a new dataset: stale page offsets would land past the end.
  useEffect(() => { setAgentPage(0); setModelPage(0); }, [days]);

  useEffect(() => {
    let alive = true;
    setErr(null);
    const q = `?days=${days}`;
    // 每个请求都要检查 r.ok。只对 overview 检查时，另外三路 401/503 的错误体会被
    // 当成数据：`.json()` 成功、`rows` 为 undefined，界面渲染成「窗口内无数据」——
    // 有故障却既不显示数据也不显示错误（2026-11-27 真机走查：登录后首次进消耗页
    // 全空，刷新才出数）。统一 reject，让下面的 catch 把 err 显示出来。
    const load = (path, label) =>
      authFetch(path).then((r) => {
        if (!r.ok) throw new Error(`${label} HTTP ${r.status}`);
        return r.json();
      });
    Promise.all([
      load(`/api/fleet/v1/stats/overview${q}`, "overview"),
      load(`/api/fleet/v1/stats/by-agent${q}`, "by-agent"),
      load(`/api/fleet/v1/stats/by-model${q}`, "by-model"),
      load(`/api/fleet/v1/stats/daily${q}`, "daily"),
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
  const agentRows = byAgent?.rows ?? [];
  const modelRows = byModel?.rows ?? [];
  const agentSlice = agentRows.slice(agentPage * PAGE_SIZE, (agentPage + 1) * PAGE_SIZE);
  const modelSlice = modelRows.slice(modelPage * PAGE_SIZE, (modelPage + 1) * PAGE_SIZE);

  return (
    <section className="space-y-4" data-testid="stats-view">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold">消耗</h2>
        <div className="flex gap-1">
          {DAY_CHOICES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-xs px-2.5 py-1 rounded-full border ${days === d ? "bg-accent text-white border-transparent" : "border-slate-300 dark:border-slate-700 text-slate-500"}`}
              data-testid={`stats-days-${d}`}
            >
              {d === 1 ? "24h" : `${d}天`}
            </button>
          ))}
        </div>
      </div>

      <StatementCard />

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

      {/* Stacked full-width, not a two-up grid: agent ids and model ids are
          long slugs, and half a card was what forced them into unreadable
          prefixes. These two tables are the ones people read row by row. */}
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-500 mb-2">按 agent（fleet/local 口径）</div>
          {/* full-width scroll: the agent id is the one field that cannot be
              shortened without losing meaning, so the table is allowed to be
              wider than the half-column card and scroll horizontally instead
              of squeezing that column to an unreadable prefix. */}
          <div className="overflow-x-auto">
          {/* table-fixed + colgroup: column widths must be a property of the
              layout. Under auto layout they track content even when every cell
              truncates (measured: 口径 came out 195px vs 188px for two value
              lengths), which leaves headers and rows misaligned. */}
          <table className="w-full min-w-[34rem] table-fixed text-sm tabular-nums" data-testid="stats-by-agent">
            <colgroup>
              <col className="w-[38%]" /><col className="w-[22%]" /><col className="w-[6rem]" /><col className="w-[4.5rem]" /><col className="w-[5.5rem]" />
            </colgroup>
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-1">agent</th><th>pack</th><th>口径</th><th className="text-right">回合</th><th className="text-right">tokens</th>
              </tr>
            </thead>
            <tbody>
              {agentSlice.map((r) => (
                <tr key={`${r.agent}|${r.pack}|${r.source}|${r.basis}`} className="border-t border-slate-100 dark:border-slate-800 align-top">
                  {/* break-all: a long slug wraps inside the column so the
                      distinguishing tail stays visible; truncate would hide it
                      behind the shared `packs-` prefix. */}
                  <td className="py-1 pr-2 font-mono text-xs break-all" title={r.agent}>{agentLabel(r.agent)}</td>
                  <td className="pr-2 text-slate-500 font-mono text-xs break-all" title={r.pack || ""}>{r.pack || "—"}</td>
                  {/* 口径 keeps its full value: short, fixed vocabulary, and
                      truncating it reintroduces the unreadable-column problem. */}
                  <td className="pr-2 text-xs whitespace-nowrap" title={`${r.source}/${r.basis}`}>{r.source}/{r.basis}</td>
                  <td className="text-right whitespace-nowrap">{r.turns}</td>
                  <td className="text-right whitespace-nowrap">{fmtTok(r.tokens_in + r.tokens_out)}</td>
                </tr>
              ))}
              {agentRows.length === 0 && (
                <tr><td colSpan={5} className="py-2 text-slate-400">窗口内无数据</td></tr>
              )}
            </tbody>
          </table>
          </div>
          <Pager page={agentPage} setPage={setAgentPage} total={agentRows.length} testid="stats-by-agent" />
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-500 mb-2">按模型</div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] table-fixed text-sm tabular-nums" data-testid="stats-by-model">
            <colgroup>
              <col className="w-[44%]" /><col className="w-[6.5rem]" /><col className="w-[4.5rem]" /><col className="w-[5.5rem]" />
            </colgroup>
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-1">model</th><th>口径</th><th className="text-right">回合</th><th className="text-right">tokens</th>
              </tr>
            </thead>
            <tbody>
              {modelSlice.map((r) => (
                <tr key={`${r.model}|${r.source}|${r.basis}`} className="border-t border-slate-100 dark:border-slate-800 align-top">
                  <td className="py-1 pr-2 font-mono text-xs break-all" title={r.model || ""}>{r.model || "（fleet 事件未带模型）"}</td>
                  <td className="pr-2 text-xs whitespace-nowrap" title={`${r.source}/${r.basis}`}>{r.source}/{r.basis}</td>
                  <td className="text-right whitespace-nowrap">{r.turns}</td>
                  <td className="text-right whitespace-nowrap">{fmtTok(r.tokens_in + r.tokens_out)}</td>
                </tr>
              ))}
              {modelRows.length === 0 && (
                <tr><td colSpan={4} className="py-2 text-slate-400">窗口内无数据</td></tr>
              )}
            </tbody>
          </table>
          </div>
          <Pager page={modelPage} setPage={setModelPage} total={modelRows.length} testid="stats-by-model" />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
        {/* polish-wanxing-console: one series per caliber (source/basis) —
            the calibers stay separate, never merged into a single bar. */}
        <div className="text-xs font-semibold text-slate-500 mb-2">每日序列（口径分列）</div>
        {(daily?.fleet ?? []).length === 0 ? (
          <div className="text-sm text-slate-400 py-2" data-testid="stats-daily">窗口内无数据</div>
        ) : (
          <DailyChart rows={daily.fleet} />
        )}
      </div>
    </section>
  );
}
