// Deployer console v1: token-gated fleet visibility (board + per-agent
// timeline) plus management actions. All credential plumbing lives in the
// shared auth module (add-console-session-continuity): this view renders —
// login/exit controls belong to the site header now.
import { useEffect, useState } from "react";
import { authFetch, loginLogto, setOpsToken, useAuth } from "../auth.js";

const fmtMs = (ms) => (ms == null ? "n/a" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const fmtAgo = (ms) => (ms == null ? "?" : ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`);

export function ConsoleView({ focusSlug } = {}) {
  const auth = useAuth();
  const token = auth.token;
  const [draft, setDraft] = useState("");
  const [board, setBoard] = useState(null);
  const [boardErr, setBoardErr] = useState(null);
  const [agent, setAgent] = useState("");
  const [timeline, setTimeline] = useState(null);
  const [tlErr, setTlErr] = useState(null);
  // Management (⑤ increment 1): deployments + per-agent allowlist.
  const [deps, setDeps] = useState(null);
  const [depErr, setDepErr] = useState(null);
  const [busy, setBusy] = useState("");
  const [callers, setCallers] = useState(null);
  const [newEmail, setNewEmail] = useState("");
  const [alNote, setAlNote] = useState("");
  // Service config (agent-service-config): per-deployment detail panel.
  const [cfg, setCfg] = useState(null); // { slug, data } — loaded read view
  const [cfgDraft, setCfgDraft] = useState({ rhythm: "", budget: "", model: "" });
  const [cfgNote, setCfgNote] = useState("");
  const [cfgBusy, setCfgBusy] = useState(false);
  // Invocation records + host allowance (add-agent-chat-lane 5.3): the
  // owner's "who called my agent" panel and the chat allowance cap editor.
  const [usage, setUsage] = useState(null); // { slug, doc }
  const [usageErr, setUsageErr] = useState("");
  const [allowance, setAllowance] = useState(null); // { slug, doc }
  const [alwDraft, setAlwDraft] = useState("");
  const [alwNote, setAlwNote] = useState("");
  const [alwBusy, setAlwBusy] = useState(false);
  // Serving plans (add-serving-plans): the caller's own statement + the
  // ops-only plan manager.
  const [stmt, setStmt] = useState(null);
  const [stmtErr, setStmtErr] = useState("");
  const [plans, setPlans] = useState(null);
  const [planErr, setPlanErr] = useState("");
  const [planDraft, setPlanDraft] = useState({ email: "", limit: "", note: "" });
  const [planBusy, setPlanBusy] = useState(false);
  // Missions (add-mission-definitions): the owner's four-tuple tasks — list,
  // create, submit/approve/abort, and the planner-artifact detail view.
  const [missions, setMissions] = useState(null);
  const [missionErr, setMissionErr] = useState("");
  const [mDraft, setMDraft] = useState({ goal: "", model: "", hours: "24", cap: "30", approval: "human" });
  const [mBusy, setMBusy] = useState(false);
  const [mDetail, setMDetail] = useState(null);
  // Deep link (#/console/<slug>): open the config panel as soon as the
  // session token is live — the 壹座 "去配置" path lands here.
  useEffect(() => {
    if (token && focusSlug) loadConfig(focusSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, focusSlug]);

  // My serving-plan statement (add-serving-plans 4.1): identity-scoped on the
  // server — this fetch can only ever read the signed-in caller's own rows.
  useEffect(() => {
    if (!token) return;
    let live = true;
    authFetch("/api/wanxing/v1/console/my/statement")
      .then(async (r) => {
        if (r.status === 403) throw new Error("ops 令牌没有身份——套餐对账请用登录身份查看");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => live && (setStmt(d), setStmtErr("")))
      .catch((e) => live && setStmtErr(String(e?.message || e)));
    return () => {
      live = false;
    };
  }, [token]);

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
    if (token) loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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

  const loadMissions = () =>
    authFetch("/api/wanxing/v1/console/missions")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (setMissions(d), setMissionErr("")))
      .catch((e) => setMissionErr(String(e?.message || e)));

  useEffect(() => {
    if (token) loadMissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const createMission = async (e) => {
    e.preventDefault();
    setMBusy(true);
    try {
      const r = await authFetch("/api/wanxing/v1/console/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: mDraft.goal,
          model: mDraft.model,
          windowStart: Date.now(),
          windowEnd: Date.now() + Math.max(1, Number(mDraft.hours) || 24) * 3_600_000,
          costCapMinutes: Number(mDraft.cap) || 30,
          approval: mDraft.approval,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setMDraft({ ...mDraft, goal: "" });
      loadMissions();
    } catch (err) {
      setMissionErr(String(err?.message || err));
    } finally {
      setMBusy(false);
    }
  };

  const missionAction = async (id, act) => {
    setMBusy(true);
    try {
      const r = await authFetch(`/api/wanxing/v1/console/missions/${id}/${act}`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error?.message || d.error || `HTTP ${r.status}`);
      loadMissions();
      if (mDetail?.id === id) openMission(id);
    } finally {
      setMBusy(false);
    }
  };

  const openMission = async (id) => {
    const r = await authFetch(`/api/wanxing/v1/console/missions/${id}`);
    const d = await r.json().catch(() => ({}));
    if (r.ok) setMDetail({ id, doc: d.mission });
  };

  useEffect(() => {
    if (!token) return;
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
  }, [token]);

  useEffect(() => {
    if (!token || !agent) return;
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
  }, [token, agent]);

  const loadDeps = () =>
    authFetch("/api/wanxing/v1/console/deployments")
      .then(async (r) => {
        if (!r.ok) throw new Error(`deployments HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (setDeps(d), setDepErr(null)))
      .catch((e) => setDepErr(String(e?.message || e)));
  useEffect(() => {
    if (!token) return;
    loadDeps();
    const t = setInterval(loadDeps, 60_000);
    return () => clearInterval(t);
  }, [token]);

  const manage = (slug, action) => {
    setBusy(`${slug}:${action}`);
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/${action}`, { method: "POST" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${action} HTTP ${r.status}`);
        loadDeps();
      })
      .catch((e) => setDepErr(String(e?.message || e)))
      .finally(() => setBusy(""));
  };

  const loadCallers = (slug) => {
    setAlNote("");
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/callers`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`callers HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setCallers({ slug, list: d.callers ?? [] }))
      .catch((e) => setAlNote(String(e?.message || e)));
  };
  const addCaller = (slug) => {
    setAlNote("");
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/callers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        setNewEmail("");
        loadCallers(slug);
      })
      .catch((e) => setAlNote(String(e?.message || e)));
  };
  const removeCaller = (slug, userId) => {
    setAlNote("");
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/callers?userId=${userId}`, {
      method: "DELETE",
    })
      .then(() => loadCallers(slug))
      .catch((e) => setAlNote(String(e?.message || e)));
  };

  const loadConfig = (slug) => {
    setCfgNote("");
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/config`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `config HTTP ${r.status}`);
        setCfg({ slug, data: d });
        const c = d.config ?? {};
        setCfgDraft({
          rhythm: c.rhythm?.effective ? JSON.stringify(c.rhythm.effective) : "",
          budget: c.budgetMinutes?.effective != null ? String(c.budgetMinutes.effective) : "",
          model: c.model?.effective ?? "",
        });
      })
      .catch((e) => setCfgNote(String(e?.message || e)));
  };
  const saveConfig = (slug) => {
    setCfgNote("");
    setCfgBusy(true);
    const body = {};
    const rhythmText = cfgDraft.rhythm.trim();
    if (rhythmText) {
      try {
        body.rhythm = JSON.parse(rhythmText);
      } catch {
        setCfgBusy(false);
        return setCfgNote("节奏必须是 JSON 数组（如 [{\"every\":\"1h\"}]）；清空则回落声明默认");
      }
    } else {
      body.rhythm = null;
    }
    body.budgetMinutes = cfgDraft.budget.trim() === "" ? null : Number(cfgDraft.budget);
    body.model = cfgDraft.model.trim() === "" ? null : cfgDraft.model.trim();
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        setCfgNote("已保存 · 节奏/预算五分钟窗内无感生效；模型变更排水重生");
        loadConfig(slug);
      })
      .catch((e) => setCfgNote(String(e?.message || e)))
      .finally(() => setCfgBusy(false));
  };
  const loadUsage = (slug) => {
    setUsageErr("");
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/usage?days=30`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `usage HTTP ${r.status}`);
        setUsage({ slug, doc: d });
      })
      .catch((e) => setUsageErr(String(e?.message || e)));
  };
  const loadAllowance = (slug) => {
    setAlwNote("");
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/host-allowance`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `allowance HTTP ${r.status}`);
        setAllowance({ slug, doc: d });
        setAlwDraft(String(d.limitMinutes ?? 0));
      })
      .catch((e) => setAlwNote(String(e?.message || e)));
  };
  const saveAllowance = (slug) => {
    setAlwNote("");
    const limit = alwDraft.trim() === "" ? 0 : Number(alwDraft);
    if (!Number.isInteger(limit) || limit < 0) return setAlwNote("额度必须是 ≥0 的整数（分钟）");
    setAlwBusy(true);
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/host-allowance`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limitMinutes: limit }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        setAllowance({ slug, doc: d });
        setAlwNote("已保存——下一回合起生效");
      })
      .catch((e) => setAlwNote(String(e?.message || e)))
      .finally(() => setAlwBusy(false));
  };
  const channelLabel = (c) => (c === "chat" ? "对话" : c === "api" ? "API" : c ?? "?");

  const sourceBadge = (dim) => {
    const s = dim?.source;
    const label = s === "override" ? "已覆盖" : s === "declared" ? "跟随声明" : "默认";
    const tone = s === "override" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800 text-slate-500";
    return <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${tone}`}>{label}</span>;
  };

  if (!token) {
    return (
      <div className="max-w-sm mx-auto mt-16 space-y-4">
        <h1 className="text-xl font-semibold">部署者控制台</h1>
        {auth.notice && (
          <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm">
            {auth.notice}
          </div>
        )}
        <button
          onClick={() => loginLogto().catch((e) => alert(String(e?.message || e)))}
          className="w-full px-3 py-2.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm"
        >
          使用寻数账号登录（Logto）
        </button>
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer select-none">运维通道：服务凭据</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setOpsToken(draft);
              setDraft("");
            }}
            className="space-y-3 pt-2"
          >
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="service token"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
            <button className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm">进入</button>
          </form>
        </details>
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
      <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
        <h2 className="font-semibold">管理 · 部署</h2>
        {depErr && <div className="text-sm text-amber-600 dark:text-amber-400">部署面读取失败（{depErr}）</div>}
        {deps && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 px-3">agent</th><th className="px-3">名称</th><th className="px-3">可见</th><th className="px-3">状态</th><th className="px-3 text-right">动作</th>
                </tr>
              </thead>
              <tbody>
                {(deps.deployments ?? []).map((d) => (
                  <tr key={d.slug} className="border-b border-slate-100 dark:border-slate-900">
                    <td className="py-1.5 px-3 font-mono">{d.slug}</td>
                    <td className="px-3">{d.name ?? "—"}</td>
                    <td className="px-3">{d.visibility ?? "?"}</td>
                    <td className="px-3">{d.paused ? <span className="text-amber-600 dark:text-amber-400">已暂停</span> : <span className="text-emerald-600 dark:text-emerald-400">运行中</span>}</td>
                    <td className="px-3 text-right space-x-2 whitespace-nowrap">
                      <button
                        disabled={busy === `${d.slug}:${d.paused ? "resume" : "pause"}`}
                        onClick={() => manage(d.slug, d.paused ? "resume" : "pause")}
                        className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40"
                      >
                        {busy === `${d.slug}:${d.paused ? "resume" : "pause"}` ? "…" : d.paused ? "恢复" : "暂停"}
                      </button>
                      <button onClick={() => loadCallers(d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700">允许清单</button>
                      <button onClick={() => loadConfig(d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700">配置</button>
                      <button onClick={() => loadUsage(d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700">记录</button>
                      <button onClick={() => loadAllowance(d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700">额度</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cfg && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="font-mono text-xs">
              服务配置 · {cfg.slug}（v{cfg.data.packVersion ?? "?"} · 只写本部署的覆盖，清空即回落声明）
            </div>
            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              <label className="space-y-1">
                <span className="text-slate-500">工作节奏（JSON 数组）{sourceBadge(cfg.data.config?.rhythm)}</span>
                <textarea
                  value={cfgDraft.rhythm}
                  onChange={(e) => setCfgDraft((p) => ({ ...p, rhythm: e.target.value }))}
                  rows={3}
                  placeholder='[{"every":"1h","do":"巡检"}]'
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500">回合预算（分钟）{sourceBadge(cfg.data.config?.budgetMinutes)}</span>
                <input
                  value={cfgDraft.budget}
                  onChange={(e) => setCfgDraft((p) => ({ ...p, budget: e.target.value }))}
                  inputMode="numeric"
                  placeholder="如 20"
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500">模型{sourceBadge(cfg.data.config?.model)}</span>
                <input
                  value={cfgDraft.model}
                  onChange={(e) => setCfgDraft((p) => ({ ...p, model: e.target.value }))}
                  list={`lanes-${cfg.slug}`}
                  placeholder="留空 = runner 默认"
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                />
                <datalist id={`lanes-${cfg.slug}`}>
                  {(cfg.data.lanes ?? []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {(cfg.data.lanes ?? []).length > 0 && (
                  <span className="block text-[10px] text-slate-400">部署键车道：{cfg.data.lanes.join(" · ")}</span>
                )}
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                disabled={cfgBusy}
                onClick={() => saveConfig(cfg.slug)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs disabled:opacity-40"
              >
                {cfgBusy ? "保存中…" : "保存"}
              </button>
              <button onClick={() => setCfg(null)} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs">收起</button>
              {cfgNote && <span className="text-xs text-amber-600 dark:text-amber-400">{cfgNote}</span>}
            </div>
          </div>
        )}
        {callers && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
            <div className="font-mono text-xs">允许清单 · {callers.slug}（私有 agent 的调用者）</div>
            {callers.list.length === 0 && <div className="text-xs text-slate-500">空——私有 agent 目前无人可调</div>}
            {callers.list.map((c) => (
              <div key={c.userId} className="flex items-center gap-3 text-xs">
                <span className="font-mono">{c.userId}</span>
                <span>{c.email}</span>
                <button onClick={() => removeCaller(callers.slug, c.userId)} className="ml-auto px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700">移除</button>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addCaller(callers.slug);
              }}
              className="flex gap-2"
            >
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="调用者邮箱（须已在计费面板登录过一次）"
                className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              />
              <button className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs">添加</button>
            </form>
            {alNote && <div className="text-xs text-amber-600 dark:text-amber-400">{alNote}</div>}
          </div>
        )}
        {usageErr && (
          <div className="rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm">
            调用记录读取失败（{usageErr}）——这不是「没有调用」，请稍后再试。
          </div>
        )}
        {usage && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid={`usage-panel-${usage.slug}`}>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs">调用记录 · {usage.slug}（近 30 天）</span>
              <button onClick={() => setUsage(null)} className="ml-auto px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-xs">收起</button>
            </div>
            {(usage.doc.byCaller ?? []).length === 0 ? (
              <div className="text-xs text-slate-500">暂无调用。</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b border-slate-200 dark:border-slate-800">
                    <th className="py-1.5 px-2">调用者</th><th className="px-2">渠道</th><th className="px-2 text-right">回合</th><th className="px-2 text-right">分钟</th><th className="px-2 text-right">最近</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.doc.byCaller.map((r, i) => (
                    <tr key={`${r.channel}-${r.email}-${i}`} className="border-b border-slate-100 dark:border-slate-900">
                      <td className="py-1.5 px-2 font-mono">{r.email || "（匿名/无邮箱）"}</td>
                      <td className="px-2">{channelLabel(r.channel)}</td>
                      <td className="px-2 text-right">{r.turns}</td>
                      <td className="px-2 text-right">{r.minutes}</td>
                      <td className="px-2 text-right text-slate-500">{r.lastAt ? new Date(r.lastAt).toLocaleString("zh-CN", { hour12: false }) : "?"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="text-xs text-slate-500 space-y-1">
              <div className="font-semibold text-slate-600 dark:text-slate-300">最近活动</div>
              {(usage.doc.activity ?? []).length === 0 && <div>无。</div>}
              {(usage.doc.activity ?? []).map((a, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-slate-400 w-36 shrink-0 font-mono">{new Date(a.at).toLocaleString("zh-CN", { hour12: false })}</span>
                  <span className="px-1.5 rounded bg-slate-100 dark:bg-slate-800">{channelLabel(a.channel)}</span>
                  <span>{a.outcome}</span>
                  <span>{a.minutes ? `${a.minutes} 分钟` : ""}</span>
                  <span className="text-slate-400 font-mono ml-auto">{a.email || ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {allowance && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid={`allowance-panel-${allowance.slug}`}>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs">对话额度（主人池） · {allowance.slug}</span>
              <button onClick={() => setAllowance(null)} className="ml-auto px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-xs">收起</button>
            </div>
            <div className="text-xs text-slate-500">
              当前上限 <b>{allowance.doc.limitMinutes ?? 0}</b> 分钟 · 剩余 <b>{allowance.doc.remainingMinutes ?? 0}</b> 分钟
              {allowance.doc.updatedBy ? ` · 上次由 ${allowance.doc.updatedBy} 设置` : ""}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveAllowance(allowance.slug);
              }}
              className="flex gap-2 items-center"
            >
              <input
                value={alwDraft}
                onChange={(e) => setAlwDraft(e.target.value)}
                inputMode="numeric"
                placeholder="新上限（分钟，0=关闭）"
                className="w-48 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
              />
              <button disabled={alwBusy} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs disabled:opacity-40">
                {alwBusy ? "保存中…" : "保存"}
              </button>
              {alwNote && <span className="text-xs text-amber-600 dark:text-amber-400">{alwNote}</span>}
            </form>
            <div className="text-[10px] text-slate-400">一次性限额：访客对话按分钟实扣你的部署计费键，扣完即止、随时可调。</div>
          </div>
        )}

        {/* Serving plans (add-serving-plans 4.1): my statement + ops manager */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="my-statement-panel">
          <h3 className="font-semibold">我的套餐</h3>
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
                套餐结算 <b>{stmt.usage.planMinutes}</b> 分钟（{stmt.usage.planTurns} 回合） · 余额路径 <b>{stmt.usage.legacyMinutes}</b> 分钟（{stmt.usage.legacyTurns} 回合）
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="missions-panel">
          <h3 className="font-semibold">我的任务</h3>
          {missionErr && <div className="text-xs text-amber-600 dark:text-amber-400">{missionErr}</div>}
          {missions && missions.plannerConfigured === false && (
            <div className="text-xs text-amber-600 dark:text-amber-400" data-testid="missions-degraded">
              平台未配置 planner（MISSION_PLANNER_SLUG）——可建草稿，提交会被显式拒绝。
            </div>
          )}
          <form onSubmit={createMission} className="space-y-2">
            <input
              value={mDraft.goal}
              onChange={(e) => setMDraft({ ...mDraft, goal: e.target.value })}
              placeholder="目标：一句话说清要 planner 做什么"
              className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
            <div className="flex gap-2 items-center flex-wrap">
              <input
                value={mDraft.model}
                onChange={(e) => setMDraft({ ...mDraft, model: e.target.value })}
                placeholder="模型（可空=默认）"
                className="w-40 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              />
              <input
                value={mDraft.hours}
                onChange={(e) => setMDraft({ ...mDraft, hours: e.target.value })}
                inputMode="numeric"
                placeholder="时间窗(小时)"
                className="w-24 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
              />
              <input
                value={mDraft.cap}
                onChange={(e) => setMDraft({ ...mDraft, cap: e.target.value })}
                inputMode="numeric"
                placeholder="成本上限(分钟)"
                className="w-28 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
              />
              <select
                value={mDraft.approval}
                onChange={(e) => setMDraft({ ...mDraft, approval: e.target.value })}
                className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              >
                <option value="human">人批计划</option>
                <option value="auto">自动执行</option>
              </select>
              <button disabled={mBusy || !mDraft.goal.trim()} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs disabled:opacity-40">
                {mBusy ? "处理中…" : "创建任务"}
              </button>
            </div>
          </form>
          {missions && missions.missions.length > 0 && (
            <div className="text-xs space-y-1" data-testid="missions-list">
              {missions.missions.map((m) => (
                <div key={m.id} className="flex gap-2 items-center flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded font-mono ${m.status === "reported" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : m.status === "failed" || m.status === "aborted" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>{m.status}</span>
                  <button onClick={() => openMission(m.id)} className="w-64 truncate text-left hover:underline">{m.goal || "—"}</button>
                  <span>已用 {m.spentMinutes}/{m.costCapMinutes} 分钟 · {m.approval === "auto" ? "自动" : "人批"}</span>
                  {m.status === "draft" && <button disabled={mBusy} onClick={() => missionAction(m.id, "submit")} className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700">提交</button>}
                  {m.status === "awaiting_approval" && <button disabled={mBusy} onClick={() => missionAction(m.id, "approve")} className="px-2 py-0.5 rounded border border-emerald-400 text-emerald-700 dark:text-emerald-300">批准</button>}
                  {!["reported", "failed", "aborted"].includes(m.status) && <button disabled={mBusy} onClick={() => missionAction(m.id, "abort")} className="px-2 py-0.5 rounded border border-rose-300 text-rose-600 dark:text-rose-300">中止</button>}
                </div>
              ))}
            </div>
          )}
          {mDetail && mDetail.doc && (
            <div className="text-xs border-t border-slate-200 dark:border-slate-800 pt-2 space-y-1" data-testid="mission-detail">
              <div className="font-mono text-slate-400">{mDetail.id}</div>
              <div>目标：{mDetail.doc.goal}</div>
              <div>窗口 {new Date(mDetail.doc.windowStart).toLocaleString()} ~ {new Date(mDetail.doc.windowEnd).toLocaleString()} · 已用 {mDetail.doc.spentMinutes}/{mDetail.doc.costCapMinutes} 分钟</div>
              {mDetail.doc.plan && (
                <div className="space-y-0.5">
                  {mDetail.doc.plan.steps.map((st) => (
                    <div key={st.id} className="flex gap-2">
                      <span className="font-mono text-slate-400">{st.id}</span>
                      <span className={`w-16 ${st.status === "done" ? "text-emerald-600" : st.status === "running" ? "text-sky-600" : "text-slate-400"}`}>{st.status}</span>
                      <span className="flex-1 truncate">{st.prompt}</span>
                    </div>
                  ))}
                </div>
              )}
              {mDetail.doc.report && <div className="whitespace-pre-wrap border-t border-slate-200 dark:border-slate-800 pt-1">{mDetail.doc.report.summary}</div>}
              <div className="text-slate-400">{mDetail.doc.history.map((x) => `${x.to}(${x.by})`).join(" → ")}</div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="plans-panel">
          <h3 className="font-semibold">套餐管理 · ops</h3>
          {planErr && <div className="text-xs text-amber-600 dark:text-amber-400">{planErr}</div>}
          <form onSubmit={savePlan} className="flex gap-2 items-center flex-wrap">
            <input
              value={planDraft.email}
              onChange={(e) => setPlanDraft({ ...planDraft, email: e.target.value })}
              placeholder="调用者邮箱（sub2api 账户）"
              className="w-56 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
            <input
              value={planDraft.limit}
              onChange={(e) => setPlanDraft({ ...planDraft, limit: e.target.value })}
              inputMode="numeric"
              placeholder="分钟上限"
              className="w-28 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
            />
            <input
              value={planDraft.note}
              onChange={(e) => setPlanDraft({ ...planDraft, note: e.target.value })}
              placeholder="备注（可选）"
              className="w-40 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
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
    </div>
  );
}
