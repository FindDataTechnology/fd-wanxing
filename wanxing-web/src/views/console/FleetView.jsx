// 我的舰队 (refactor-console-ia, M4④ 前置): the deployer's fleet — the
// deployments table with its management panels (config / allowlist / usage /
// allowance), the plan statement, and the deploy wizard with earnings.
// Moved verbatim from the ConsoleView monolith; behavior and testids
// unchanged. The ④b cockpit visualization lands ON this skeleton.
import { useEffect, useState } from "react";
import { authFetch } from "../../auth.js";
import { DeployWizard } from "./DeployWizard.jsx";
import { channelLabel, sourceBadge } from "./shared.jsx";

export function FleetView({ focusSlug } = {}) {
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
  // Embed settings (add-embed-copilot-lane 5.1): per-agent anonymous switch +
  // allowed embedding origins, and the copy-paste embed snippet.
  const [embedS, setEmbedS] = useState(null); // { slug, doc }
  const [embedDraft, setEmbedDraft] = useState({ anonymous: false, origins: "" });
  const [embedNote, setEmbedNote] = useState("");
  const [embedBusy, setEmbedBusy] = useState(false);
  // Serving plans (add-serving-plans): the caller's own statement.
  const [stmt, setStmt] = useState(null);
  const [stmtErr, setStmtErr] = useState("");
  // Deployer self-service (add-deployer-self-service M3① → add-deploy-wizard
  // M4①): my packs feed the stepped deployment wizard.
  const [myPacks, setMyPacks] = useState(null);
  const [myPacksErr, setMyPacksErr] = useState("");
  // Deployer earnings (add-deployer-revenue-share, ADR-0022): closed-loop
  // revenue share for externally-settled turns on my deployments.
  const [earn, setEarn] = useState(null);
  // Cockpit summary (add-cockpit-views, M4④b): per-slug usage aggregates +
  // allowances — the cards' signal column, polled with the deployments list.
  const [summary, setSummary] = useState(null);
  const [earnErr, setEarnErr] = useState("");
  // Deep link (#/console/<slug>): open the config panel as soon as the
  // session token is live — the 壹座 "去配置" path lands here.
  useEffect(() => {
    if (focusSlug) loadConfig(focusSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSlug]);

  // My serving-plan statement (add-serving-plans 4.1): identity-scoped on the
  // server — this fetch can only ever read the signed-in caller's own rows.
  useEffect(() => {
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
  }, []);

  // My earnings (add-deployer-revenue-share): same identity scoping — a 402/502
  // style failure is shown as an explicit error, never as "no earnings".
  useEffect(() => {
    let live = true;
    authFetch("/api/wanxing/v1/console/my/earnings")
      .then(async (r) => {
        if (r.status === 403) throw new Error("ops 令牌没有身份——收益请用登录身份查看");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => live && (setEarn(d), setEarnErr("")))
      .catch((e) => live && setEarnErr(String(e?.message || e)));
    return () => {
      live = false;
    };
  }, []);

  const loadMyPacks = () =>
    authFetch("/api/wanxing/v1/console/my/packs")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (setMyPacks(d), setMyPacksErr("")))
      .catch((e) => setMyPacksErr(String(e?.message || e)));

  useEffect(() => {
    loadMyPacks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSummary = () =>
    authFetch("/api/wanxing/v1/console/fleet/summary")
      .then(async (r) => (r.ok ? r.json() : null))
      .then((d) => setSummary(d))
      .catch(() => { /* cards degrade their signal columns honestly */ });

  const loadDeps = () =>
    authFetch("/api/wanxing/v1/console/deployments")
      .then(async (r) => {
        if (!r.ok) throw new Error(`deployments HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (setDeps(d), setDepErr(null)))
      .catch((e) => setDepErr(String(e?.message || e)));
  useEffect(() => {
    loadDeps();
    loadSummary();
    const t = setInterval(() => {
      loadDeps();
      loadSummary();
    }, 60_000);
    return () => clearInterval(t);
  }, []);

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

  // Embed settings (add-embed-copilot-lane 5.1): the origins textarea is one
  // origin per line; the panel carries the copy-paste snippet so the flow
  // from "开关" to "贴进产品线" never leaves this card.
  const loadEmbed = (slug) => {
    setEmbedNote("");
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/embed-settings`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `embed HTTP ${r.status}`);
        setEmbedS({ slug, doc: d });
        setEmbedDraft({ anonymous: d.anonymous === true, origins: (d.origins ?? []).join("\n") });
      })
      .catch((e) => setEmbedNote(String(e?.message || e)));
  };
  const saveEmbed = (slug) => {
    setEmbedNote("");
    const origins = embedDraft.origins.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (origins.length > 20) return setEmbedNote("至多 20 个允许源");
    if (origins.some((o) => !/^https?:\/\/[^\s/]+$/.test(o.replace(/\/+$/, "")))) return setEmbedNote("每行一个源，形如 https://example.com");
    setEmbedBusy(true);
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/embed-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anonymous: embedDraft.anonymous, origins }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        setEmbedS({ slug, doc: d });
        setEmbedDraft({ anonymous: d.anonymous === true, origins: (d.origins ?? []).join("\n") });
        setEmbedNote("已保存——下一次匿名凭据铸发起生效");
      })
      .catch((e) => setEmbedNote(String(e?.message || e)))
      .finally(() => setEmbedBusy(false));
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h2 className="font-semibold">管理 · 部署</h2>
        {depErr && <div className="text-sm text-amber-600 dark:text-amber-400">部署面读取失败（{depErr}）</div>}
        {deps && (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="fleet-cards">
            {(deps.deployments ?? []).map((d) => {
              // The summary's signal columns degrade to placeholders — never
              // fake zeros — when the summary call hasn't landed.
              const sig = summary?.agents?.[d.slug] ?? null;
              const unknown = summary === null;
              return (
                <div key={d.slug} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5" data-testid={`fleet-card-${d.slug}`}>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded font-mono text-[11px] ${d.paused ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"}`}>
                      {d.paused ? "已暂停" : "运行中"}
                    </span>
                    <span className="font-semibold text-sm">{d.name ?? d.slug}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">{d.visibility === "private" ? "私有" : "公开"}</span>
                    <a href={`#/chat/${encodeURIComponent(d.slug)}`} className="ml-auto text-xs text-sky-600 dark:text-sky-400 hover:underline">对话 →</a>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs" data-testid={`fleet-signals-${d.slug}`}>
                    <div>
                      <div className="text-slate-400 text-[10px]">近 7 天回合</div>
                      <div className="font-semibold">{unknown ? "…" : (sig?.turns7d ?? 0)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[10px]">近 30 天分钟</div>
                      <div className="font-semibold">{unknown ? "…" : (sig?.minutes30d ?? 0)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-[10px]">近 30 天结算</div>
                      <div className="font-semibold">{unknown ? "…" : `$${(sig?.usd30d ?? 0).toFixed(2)}`}</div>
                    </div>
                  </div>
                  {sig?.allowance && (
                    <div className="text-xs" data-testid={`fleet-allowance-${d.slug}`}>
                      <div className="flex justify-between text-slate-500">
                        <span>对话额度</span>
                        <span>余 {sig.allowance.remainingMinutes}/{sig.allowance.limitMinutes} 分钟</span>
                      </div>
                      <div className="h-1.5 mt-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full ${sig.allowance.remainingMinutes <= 0 ? "bg-rose-500" : sig.allowance.limitMinutes && sig.allowance.remainingMinutes / sig.allowance.limitMinutes <= 0.2 ? "bg-amber-500" : "bg-sky-500"}`}
                          style={{ width: `${sig.allowance.limitMinutes ? Math.min(100, (sig.allowance.remainingMinutes / sig.allowance.limitMinutes) * 100) : 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap pt-0.5">
                    <button
                      disabled={busy === `${d.slug}:${d.paused ? "resume" : "pause"}`}
                      onClick={() => manage(d.slug, d.paused ? "resume" : "pause")}
                      className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs disabled:opacity-40"
                    >
                      {busy === `${d.slug}:${d.paused ? "resume" : "pause"}` ? "…" : d.paused ? "恢复" : "暂停"}
                    </button>
                    <button onClick={() => loadConfig(d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">配置</button>
                    <button onClick={() => loadUsage(d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">记录</button>
                    <button onClick={() => loadAllowance(d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">额度</button>
                    <button onClick={() => loadEmbed(d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">嵌入</button>
                    <button onClick={() => loadCallers(d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">允许清单</button>
                    <details className="text-[11px] text-slate-400 ml-auto self-center">
                      <summary className="cursor-pointer select-none">slug</summary>
                      <code className="block mt-1 font-mono">{d.slug}</code>
                    </details>
                  </div>
                </div>
              );
            })}
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
            {(callers.list ?? []).length === 0 && <div className="text-xs text-slate-500">空——私有 agent 目前无人可调</div>}
            {(callers.list ?? []).map((c) => (
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
            {(usage.doc?.byCaller ?? []).length === 0 ? (
              <div className="text-xs text-slate-500">暂无调用。</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b border-slate-200 dark:border-slate-800">
                    <th className="py-1.5 px-2">调用者</th><th className="px-2">渠道</th><th className="px-2 text-right">回合</th><th className="px-2 text-right">分钟</th><th className="px-2 text-right">最近</th>
                  </tr>
                </thead>
                <tbody>
                  {(usage.doc?.byCaller ?? []).map((r, i) => (
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
              {(usage.doc?.activity ?? []).length === 0 && <div>无。</div>}
              {(usage.doc?.activity ?? []).map((a, i) => (
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
              当前上限 <b>{allowance.doc?.limitMinutes ?? 0}</b> 分钟 · 剩余 <b>{allowance.doc?.remainingMinutes ?? 0}</b> 分钟
              {allowance.doc?.updatedBy ? ` · 上次由 ${allowance.doc.updatedBy} 设置` : ""}
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
                className="w-48 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
              />
              <button disabled={alwBusy} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs disabled:opacity-40">
                {alwBusy ? "保存中…" : "保存"}
              </button>
              {alwNote && <span className="text-xs text-amber-600 dark:text-amber-400">{alwNote}</span>}
            </form>
            <div className="text-[10px] text-slate-400">一次性限额：访客对话按分钟实扣你的部署计费键，扣完即止、随时可调。</div>
          </div>
        )}
        {embedS && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid={`embed-panel-${embedS.slug}`}>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs">嵌入助手（副驾 widget） · {embedS.slug}</span>
              <button onClick={() => setEmbedS(null)} className="ml-auto px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-xs">收起</button>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={embedDraft.anonymous}
                onChange={(e) => setEmbedDraft((d) => ({ ...d, anonymous: e.target.checked }))}
                data-testid={`embed-anon-toggle-${embedS.slug}`}
              />
              开放匿名对话（访客免登录，按平台匿名日额计费；关闭后仅登录访客可聊）
            </label>
            <div className="space-y-1">
              <div className="text-xs text-slate-500">允许嵌入的网页源（每行一个，形如 https://lex.finddatatech.cloud）——匿名凭据只对这些源铸发。</div>
              <textarea
                value={embedDraft.origins}
                onChange={(e) => setEmbedDraft((d) => ({ ...d, origins: e.target.value }))}
                rows={3}
                spellCheck={false}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                placeholder={"https://lex.finddatatech.cloud\nhttps://wire.finddatatech.cloud"}
              />
            </div>
            <div className="flex gap-2 items-center">
              <button
                disabled={embedBusy}
                onClick={() => saveEmbed(embedS.slug)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs disabled:opacity-40"
              >
                {embedBusy ? "保存中…" : "保存"}
              </button>
              {embedNote && <span className="text-xs text-amber-600 dark:text-amber-400">{embedNote}</span>}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-slate-500">嵌入代码（贴进产品线页面；宿主上下文/身份递送见文档「嵌入车道」）：</div>
              <pre className="overflow-x-auto rounded-lg bg-slate-100 dark:bg-slate-900 p-2 text-[10px] font-mono text-slate-600 dark:text-slate-300">{`<iframe src="${window.location.origin}/#/embed/${embedS.slug}?open=1"
  style="position:fixed;bottom:0;right:0;width:420px;height:640px;border:0;
  background:transparent;z-index:2147483000"
  allow="clipboard-write" title="助手"></iframe>`}</pre>
              <div className="text-[10px] text-slate-400">弹窗登录需浏览器允许该 iframe 弹窗（默认允许；若宿主加了 sandbox 需含 allow-popups）。</div>
            </div>
          </div>
        )}
      </div>

      {/* Serving plans (add-serving-plans 4.1): my statement */}
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
              套餐结算 <b>{stmt.usage?.planMinutes ?? 0}</b> 分钟（{stmt.usage?.planTurns ?? 0} 回合） · 余额路径 <b>{stmt.usage?.legacyMinutes ?? 0}</b> 分钟（{stmt.usage?.legacyTurns ?? 0} 回合）
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="deploy-panel">
        <h3 className="font-semibold">部署我的 agent <a href="#/collections" className="ml-2 text-xs font-normal text-sky-600 dark:text-sky-400 hover:underline" data-testid="collections-entry-link">我的集合 →</a></h3>
        {myPacksErr && <div className="text-xs text-amber-600 dark:text-amber-400">{myPacksErr}</div>}
        {myPacks && (myPacks.packs?.length ?? 0) === 0 && (
          <div className="text-xs text-slate-500">名下暂无已发布的 pack——先在壹座「设置 → 功能集」发布（含 serving 契约的 agent 才可部署）。</div>
        )}
        {myPacks && (myPacks.packs?.length ?? 0) > 0 && (
          <DeployWizard packs={myPacks.packs} loadMyPacks={loadMyPacks} authFetch={authFetch} />
        )}
        <div className="text-xs border-t border-slate-200 dark:border-slate-800 pt-2 space-y-1" data-testid="earnings-section">
          <div className="font-semibold">我的收益</div>
          {earnErr && (
            <div className="text-amber-600 dark:text-amber-400" data-testid="earnings-error">
              收益读取失败（{earnErr}）——这不是「没有收益」，请稍后再试。
            </div>
          )}
          {earn && (
            <div className="space-y-1" data-testid="earnings-body">
              <div>
                已入账 <b className="text-emerald-600 dark:text-emerald-400">${(earn.totals?.settledUsd ?? 0).toFixed(4)}</b>
                {" · "}待入账 <b>${(earn.totals?.pendingUsd ?? 0).toFixed(4)}</b>
                {" · "}共 {earn.totals?.turns ?? 0} 笔（外部真金回合的分成，入账即抵扣平台消耗，暂不支持提现）
              </div>
              {(earn.rows ?? []).length === 0 && <div className="text-slate-500">暂无分成记录——外部调用者经 API 车道付费调用你的 agent 时产生。</div>}
              {(earn.rows ?? []).length > 0 && (
                <div className="space-y-0.5" data-testid="earnings-rows">
                  {(earn.rows ?? []).map((r) => (
                    <div key={r.usageId} className="flex gap-2 items-center flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded font-mono ${r.status === "settled" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>{r.status === "settled" ? "已入账" : "待入账"}</span>
                      <span className="font-mono">{r.agentSlug}</span>
                      <span>回合收入 ${r.revenueUsd?.toFixed(4)} → 分成 <b>${r.amountUsd?.toFixed(4)}</b>（抽成 {(r.commission * 100).toFixed(0)}%）</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
