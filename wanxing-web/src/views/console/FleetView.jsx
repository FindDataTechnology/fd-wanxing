// 我的舰队 (refactor-console-ia, M4④ 前置): the deployer's fleet — the
// deployments table with its management panels and the deploy wizard with
// earnings. Moved verbatim from the ConsoleView monolith; behavior and testids
// unchanged. The ④b cockpit visualization lands ON this skeleton. The
// caller-side statement card (API 调用对账) lives in the 消耗 view
// (add-plan-requests-and-move-statement).
// polish-wanxing-console D1: the six management panels (config / callers /
// memory / usage / allowance / embed) open in a right-side drawer, one at a
// time, instead of stacking below the cards — same panels, same endpoints,
// same testids, different container. D2: successful writes confirm with a
// toast; errors stay in the panel/card banners where they can persist.
import { useMemo, useEffect, useState  } from "react";
import { authFetch } from "../../auth.js";
import { DeployWizard } from "./DeployWizard.jsx";
import { Drawer } from "../../components/Drawer.jsx";
import { useToast } from "../../components/Toast.jsx";
import { channelLabel, sourceBadge, HealthBadge, healthCauseLabel } from "./shared.jsx";
import { factOf, badgeFor } from "../../status-facts.js";

// A deployment's single status fact (unify-wanxing-surface-language D1/D2).
// The facade status is derived here because the fleet row carries only `paused`
// plus the usage summary's turn count — the same "近 7 天有没有调用" the facade's
// serving/idle means. When NEITHER source knows anything yet (summary not
// landed and the health section unavailable) this answers null and the card
// shows no status marker at all, rather than flashing a confident "状态未知".
export function fleetFactOf({ paused, sig, summaryLanded, health, healthSectionUp }) {
  const status =
    paused === true
      ? "paused"
      : summaryLanded
        ? (Number(sig?.turns7d) > 0 ? "serving" : "idle")
        : undefined;
  if (status === undefined && !healthSectionUp && !health) return null;
  return factOf({ status, health, healthSectionUp });
}

// A deployment nobody can use must not sit below ones that work. Only
// failing/degraded reorder; everything else keeps its original position.
// flag-stalled-rhythm-agents 3.2: a stalled agent outranks a merely silent one
// — "should have run and did not" is actionable, "nobody called it" is not.
const healthRank = (h) => (h?.health === "failing" ? 0 : h?.health === "degraded" ? 1 : h?.stalled === true ? 2 : 3);

/**
 * One sentence a deployer reads before any figure (wanxing-first-impression D5).
 * It is a SENTENCE-IZATION of facts the card already holds — never a new
 * judgement. Every branch therefore agrees with the badge beside it; a
 * disagreement means something bypassed the fact table.
 */
export function fleetConclusion({ fact, sig, health, summaryLanded }) {
  const turns = Number(sig?.turns7d);
  const cause = health?.lastErrorKind ? healthCauseLabel(health.lastErrorKind) : "";
  switch (fact) {
    case "paused":
      return "已暂停，访客不可用";
    case "unknown":
      return "状态未知（快照不可得）";
    case "failing":
      return `持续失败${cause ? ` · ${cause}` : ""}`;
    case "degraded":
      return `部分失败${cause ? ` · ${cause}` : ""}`;
    case "stalled": {
      const n = Number(health?.expected_turns);
      return Number.isFinite(n) ? `该跑没跑 · 按声明应有 ${n} 次` : "该跑没跑";
    }
    case "unused":
      return summaryLanded ? "尚无调用" : "尚无调用记录";
    case "live":
      return summaryLanded && Number.isFinite(turns) && turns > 0
        ? `近 7 天 ${turns} 回合，无健康告警`
        : "在役";
    default:
      return null; // no conclusion beats a confident wrong one
  }
}

export function FleetView({ focusSlug } = {}) {
  const toast = useToast();
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
  // Deployment memory (add-memory-visibility-console): { slug, doc } + layer
  // filter; forget is two-step (armed path → confirm posts, then reload).
  const [memory, setMemory] = useState(null); // { slug, doc }
  const [memoryErr, setMemoryErr] = useState(null);
  const [memoryLayer, setMemoryLayer] = useState("");
  const [memoryArmed, setMemoryArmed] = useState(null); // item path pending confirm
  // The lane flag rides the deployments list; sticky-once-seen avoids
  // flicker when one poll races the flag.
  const memoryLaneAvailable = useMemo(() => Array.isArray(deps?.deployments) && deps.deployments.some((d) => d.memory), [deps]);
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
  // Agent health (surface-silent-agent-failures 3.1): keyed by agent slug, the
  // same identity the deployments list and the event stream use. null = the
  // section is unavailable, and the cards then show NO health marker at all —
  // a missing signal must never render as "healthy".
  const [healthByAgent, setHealthByAgent] = useState(null);
  const [earnErr, setEarnErr] = useState("");
  // Ownership feedback (fix-fleet-scope-and-owner-gates): a refused or failed
  // panel load reports at the card that launched it — never solely inside the
  // panel that failed to open. One slot, keyed `${slug}:${action}`; the
  // latest error wins.
  const [cardErr, setCardErr] = useState(null); // { key, text }
  const clearCardErr = (key) => setCardErr((p) => (p?.key === key ? null : p));
  // The drawer slot (polish-wanxing-console D1): { kind } while open — the
  // panel's own state (cfg/callers/…) carries the slug it loaded. Opening a
  // second panel replaces the first; closing keeps the loaded data around so
  // a re-open is instant, matching the old never-unmount behavior.
  const [panel, setPanel] = useState(null); // "config" | "callers" | "memory" | "usage" | "allowance" | "embed"
  const closePanel = () => setPanel(null);
  const withStatus = async (r, fallback) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d?.error || `${fallback} HTTP ${r.status}`), { status: r.status });
    return d;
  };
  const cardErrText = (label, e) =>
    e?.status === 403
      ? `${label}未打开——这不是你部署的 agent，仅部署者本人（或运维）可管理`
      : `${label}加载失败（${String(e?.message || e)}）——服务暂不可用，请稍后重试`;
  // Deep link (#/console/<slug>): open the config panel as soon as the
  // session token is live — the 壹座 "去配置" path lands here.
  useEffect(() => {
    if (focusSlug) { setPanel("config"); loadConfig(focusSlug); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSlug]);

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

  const loadHealth = () =>
    authFetch("/api/fleet/v1/board")
      .then(async (r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.agent_health)) { setHealthByAgent(null); return; }
        setHealthByAgent(Object.fromEntries(d.agent_health.map((h) => [h.agent, h])));
      })
      .catch(() => setHealthByAgent(null));

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
    loadHealth();
    const t = setInterval(() => {
      loadDeps();
      loadSummary();
      loadHealth();
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const manage = (slug, action) => {
    setBusy(`${slug}:${action}`);
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/${action}`, { method: "POST" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${action} HTTP ${r.status}`);
        toast(`${action === "pause" ? "已暂停" : "已恢复"} · ${slug}`);
        loadDeps();
      })
      .catch((e) => setDepErr(String(e?.message || e)))
      .finally(() => setBusy(""));
  };

  const loadCallers = (slug) => {
    setAlNote("");
    clearCardErr(`${slug}:allowlist`);
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/callers`)
      .then((r) => withStatus(r, "callers"))
      .then((d) => setCallers({ slug, list: d.callers ?? [] }))
      .catch((e) => setCardErr({ key: `${slug}:allowlist`, text: cardErrText("允许清单", e) }));
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
        toast("已添加调用者");
        loadCallers(slug);
      })
      .catch((e) => setAlNote(String(e?.message || e)));
  };
  const removeCaller = (slug, userId) => {
    setAlNote("");
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/callers?userId=${userId}`, {
      method: "DELETE",
    })
      .then(() => {
        toast("已移除调用者");
        loadCallers(slug);
      })
      .catch((e) => setAlNote(String(e?.message || e)));
  };

  const loadConfig = (slug) => {
    setCfgNote("");
    clearCardErr(`${slug}:config`);
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/config`)
      .then((r) => withStatus(r, "config"))
      .then((d) => {
        setCfg({ slug, data: d });
        const c = d.config ?? {};
        setCfgDraft({
          rhythm: c.rhythm?.effective ? JSON.stringify(c.rhythm.effective) : "",
          budget: c.budgetMinutes?.effective != null ? String(c.budgetMinutes.effective) : "",
          model: c.model?.effective ?? "",
        });
      })
      .catch((e) => setCardErr({ key: `${slug}:config`, text: cardErrText("配置", e) }));
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
        toast("配置已保存");
        loadConfig(slug);
      })
      .catch((e) => setCfgNote(String(e?.message || e)))
      .finally(() => setCfgBusy(false));
  };
  const loadUsage = (slug) => {
    setUsageErr("");
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/usage?days=30`)
      .then((r) => withStatus(r, "usage"))
      .then((d) => setUsage({ slug, doc: d }))
      .catch((e) => setUsageErr(e)); // carries .status — the banner words by refusal vs outage
  };
  const loadMemory = (slug, layer = memoryLayer) => {
    setMemoryErr(null);
    setMemoryArmed(null);
    setMemoryLayer(layer);
    const q = new URLSearchParams({ limit: "50" });
    if (layer) q.set("layer", layer);
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/memory?${q.toString()}`)
      .then((r) => withStatus(r, "memory"))
      .then((d) => setMemory({ slug, doc: d }))
      .catch((e) => setMemoryErr(e)); // .status — 403 refusal vs 503 degraded lane
  };
  const forgetMemoryItem = (slug, path) => {
    setMemoryErr(null);
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/memory/forget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, confirm: true }),
    })
      .then((r) => withStatus(r, "memory"))
      .then(() => {
        toast("已遗忘该条目");
        loadMemory(slug);
      })
      .catch((e) => setMemoryErr(e));
  };
  const loadAllowance = (slug) => {
    setAlwNote("");
    clearCardErr(`${slug}:allowance`);
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/host-allowance`)
      .then((r) => withStatus(r, "allowance"))
      .then((d) => {
        setAllowance({ slug, doc: d });
        setAlwDraft(String(d.limitMinutes ?? 0));
      })
      .catch((e) => setCardErr({ key: `${slug}:allowance`, text: cardErrText("额度", e) }));
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
        toast("额度已保存——下一回合起生效");
      })
      .catch((e) => setAlwNote(String(e?.message || e)))
      .finally(() => setAlwBusy(false));
  };

  // Embed settings (add-embed-copilot-lane 5.1): the origins textarea is one
  // origin per line; the panel carries the copy-paste snippet so the flow
  // from "开关" to "贴进产品线" never leaves this card.
  const loadEmbed = (slug) => {
    setEmbedNote("");
    clearCardErr(`${slug}:embed`);
    authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/embed-settings`)
      .then((r) => withStatus(r, "embed"))
      .then((d) => {
        setEmbedS({ slug, doc: d });
        setEmbedDraft({ anonymous: d.anonymous === true, origins: (d.origins ?? []).join("\n") });
      })
      .catch((e) => setCardErr({ key: `${slug}:embed`, text: cardErrText("嵌入", e) }));
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
        toast("嵌入设置已保存");
      })
      .catch((e) => setEmbedNote(String(e?.message || e)))
      .finally(() => setEmbedBusy(false));
  };

  // Drawer title bar per panel kind. Kept as data, not six wrappers.
  const PANEL_TITLES = { config: "服务配置", callers: "允许清单", memory: "记忆", usage: "调用记录", allowance: "对话额度（主人池）", embed: "嵌入助手（副驾 widget）" };
  const openPanel = (kind, slug) => {
    setPanel(kind);
    if (kind === "memory") return loadMemory(slug); // explicit: not in the fetch map below
    ({ config: loadConfig, callers: loadCallers, usage: loadUsage, allowance: loadAllowance, embed: loadEmbed })[kind](slug);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h2 className="font-semibold">管理 · 部署</h2>
        {depErr && <div className="text-sm text-amber-600 dark:text-amber-400">部署面读取失败（{depErr}）</div>}
        {deps && (deps.deployments ?? []).length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-xs text-slate-500" data-testid="fleet-empty">
            名下暂无部署——在下方「部署我的 agent」选一个自己的 pack，或经「目录可部署」部署他人发布的 pack。
          </div>
        )}
        {/* Orphan refusal (deep link to a foreign slug): the card that
            launched the load isn't in the scoped list, so the per-card note
            has nowhere to hang — surface it at section level instead. */}
        {cardErr && !((deps?.deployments ?? []).some((d) => cardErr.key.startsWith(`${d.slug}:`))) && (
          <div className="text-xs text-amber-600 dark:text-amber-400" data-testid="fleet-orphan-err">{cardErr.text}</div>
        )}
        {deps && (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="fleet-cards">
            {([...(deps.deployments ?? [])]
              .sort((a, b) => healthRank(healthByAgent?.[a.slug]) - healthRank(healthByAgent?.[b.slug])))
              .map((d) => {
              // The summary's signal columns degrade to placeholders — never
              // fake zeros — when the summary call hasn't landed.
              const sig = summary?.agents?.[d.slug] ?? null;
              const unknown = summary === null;
              const hh = healthByAgent?.[d.slug] ?? null;
              // One badge per card: the status fact wins its slot outright, and
              // HealthBadge only speaks when the fact is NOT one it already
              // names (otherwise a failing agent wore both 「运行中」 and
              // 「持续失败」 side by side — the exact contradiction this change
              // removes). HealthBadge still carries the richer detail (failure
              // cause, since, expected count), so it renders for failing /
              // degraded / stalled and stays silent for paused / silent.
              const fact = fleetFactOf({
                paused: d.paused,
                sig,
                summaryLanded: summary !== null,
                health: hh,
                healthSectionUp: healthByAgent !== null,
              });
              // Richer detail lives in HealthBadge (failure cause, since, expected
              // count); when it applies it REPLACES the plain fact badge so the card
              // still carries exactly one status marker.
              const useHealthChip = Boolean(hh) && ["failing", "degraded", "stalled"].includes(fact);
              const conclusion = fleetConclusion({ fact, sig, health: hh, summaryLanded: summary !== null });
              // 整组全零 = 新部署/没人用，而不是「坏了」；单格为 0 仍照常显示。
              const allZero =
                !unknown &&
                !Number(sig?.turns7d) && !Number(sig?.minutes30d) && !Number(sig?.usd30d);
              return (
                <div key={d.slug} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5" data-testid={`fleet-card-${d.slug}`}>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {useHealthChip ? (
                      <HealthBadge health={hh} slug={d.slug} />
                    ) : fact ? (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[11px] ${badgeFor(fact).cls}`}
                        data-testid={`fleet-status-${d.slug}`}
                      >
                        {badgeFor(fact).label}
                      </span>
                    ) : null}
                    <span className="font-semibold text-sm">{d.name ?? d.slug}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">{d.visibility === "private" ? "私有" : "公开"}</span>
                    <a href={`#/chat/${encodeURIComponent(d.slug)}`} className="ml-auto text-xs text-accent dark:text-accent hover:underline">对话 →</a>
                  </div>
                  {/* The card opens with a readable conclusion (7.1): a deployer
                      scanning the grid learns each deployment's situation before
                      reading a single figure. Derived from the same facts as the
                      badge above — never a second judgement. */}
                  {conclusion && (
                    <p className="text-xs text-slate-600 dark:text-slate-300" data-testid={`fleet-conclusion-${d.slug}`}>
                      {conclusion}
                    </p>
                  )}
                  {/* 三格：占位（未落地）→ 一句空态（已落地且全零）→ 正常数值。
                      全零的判据是整组，不是单格：有回合但零分钟这种真事实必须照常显示 0。 */}
                  {unknown || !allZero ? (
                    <div className="grid grid-cols-3 gap-2 text-xs" data-testid={`fleet-signals-${d.slug}`}>
                      <div>
                        <div className="text-slate-400 text-[11px]">近 7 天回合</div>
                        <div className="font-semibold">{unknown ? "…" : (sig?.turns7d ?? 0)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[11px]">近 30 天分钟</div>
                        <div className="font-semibold">{unknown ? "…" : (sig?.minutes30d ?? 0)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[11px]">近 30 天结算</div>
                        <div className="font-semibold">{unknown ? "…" : `$${(sig?.usd30d ?? 0).toFixed(2)}`}</div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400" data-testid={`fleet-signals-empty-${d.slug}`}>
                      尚无调用记录——它已上线并可对话，说一句话就是第一条记录。
                    </p>
                  )}
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
                  {/* 操作分层（D5）：卡面留两个高频的——配置 / 记录；其余低频管理面
                      与暂停/恢复收进「更多」。每个按钮的 onClick / 端点 / testid 一字不改，只换容器。 */}
                  <div className="flex gap-2 flex-wrap items-center pt-0.5">
                    <button onClick={() => openPanel("config", d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">配置</button>
                    <button onClick={() => openPanel("usage", d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">记录</button>
                    <details className="text-xs" data-testid={`fleet-more-${d.slug}`}>
                      <summary className="cursor-pointer select-none px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-500">
                        更多管理
                      </summary>
                      <div className="flex gap-2 flex-wrap mt-1.5">
                        <button
                          disabled={busy === `${d.slug}:${d.paused ? "resume" : "pause"}`}
                          onClick={() => manage(d.slug, d.paused ? "resume" : "pause")}
                          className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs disabled:opacity-40"
                        >
                          {busy === `${d.slug}:${d.paused ? "resume" : "pause"}` ? "…" : d.paused ? "恢复" : "暂停"}
                        </button>
                        {memoryLaneAvailable && <button onClick={() => openPanel("memory", d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">记忆</button>}
                        <button onClick={() => openPanel("allowance", d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">额度</button>
                        <button onClick={() => openPanel("embed", d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">嵌入</button>
                        <button onClick={() => openPanel("callers", d.slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">允许清单</button>
                      </div>
                    </details>
                    <details className="text-[11px] text-slate-400 ml-auto self-center">
                      <summary className="cursor-pointer select-none">slug</summary>
                      <code className="block mt-1 font-mono">{d.slug}</code>
                    </details>
                  </div>
                  {cardErr?.key.startsWith(`${d.slug}:`) && (
                    <div className="text-xs text-amber-600 dark:text-amber-400" data-testid={`fleet-card-err-${d.slug}`}>{cardErr.text}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {panel && (
          <Drawer title={<span className="font-mono text-xs">{PANEL_TITLES[panel]} · {(panel === "config" ? cfg : panel === "callers" ? callers : panel === "memory" ? memory : panel === "usage" ? usage : panel === "allowance" ? allowance : embedS)?.slug ?? "…"}</span>} onClose={closePanel}>
            {panel === "config" && cfg && (
              <div className="space-y-3" data-testid={`config-panel-${cfg.slug}`}>
                <div className="text-xs text-slate-500">
                  v{cfg.data.packVersion ?? "?"} · 只写本部署的覆盖，清空即回落声明
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
                      <span className="block text-[11px] text-slate-400">部署键车道：{cfg.data.lanes.join(" · ")}</span>
                    )}
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    disabled={cfgBusy}
                    onClick={() => saveConfig(cfg.slug)}
                    className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-40"
                  >
                    {cfgBusy ? "保存中…" : "保存"}
                  </button>
                  <button onClick={closePanel} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs">收起</button>
                  {cfgNote && <span className="text-xs text-amber-600 dark:text-amber-400">{cfgNote}</span>}
                </div>
              </div>
            )}
            {panel === "callers" && callers && (
              <div className="space-y-2" data-testid={`allowlist-panel-${callers.slug}`}>
                <div className="text-xs text-slate-500">私有 agent 的调用者</div>
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
                  <input aria-label="调用者邮箱"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="调用者邮箱（须已在计费面板登录过一次）"
                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                  <button className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs">添加</button>
                </form>
                {alNote && <div className="text-xs text-amber-600 dark:text-amber-400">{alNote}</div>}
              </div>
            )}
            {panel === "memory" && (
              <>
                {memoryErr && (
                  <div className="rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm" data-testid="memory-error">
                    {memoryErr?.status === 403 ? (
                      <>无权读取——这不是你部署的 agent，仅部署者本人（或运维）可查看记忆。</>
                    ) : (
                      <>记忆读取失败（{String(memoryErr?.message || memoryErr)}）——这不是「没有记忆」，是车道暂不可达，请稍后再试。</>
                    )}
                  </div>
                )}
                {memory && (
                  <div className="space-y-3" data-testid={`memory-panel-${memory.slug}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex gap-1">
                        {["", "L0", "L1", "L2"].map((l) => (
                          <button
                            key={l || "all"}
                            onClick={() => loadMemory(memory.slug, l)}
                            className={`px-2 py-0.5 rounded border text-xs ${memoryLayer === l ? "border-slate-900 dark:border-slate-100" : "border-slate-300 dark:border-slate-700"}`}
                          >
                            {l || "全部"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(memory.doc?.items ?? []).length === 0 ? (
                      <div className="text-xs text-slate-500">暂无记忆条目。</div>
                    ) : (
                      <div className="space-y-1">
                        {(memory.doc?.items ?? []).map((it, i) => (
                          <div key={`${it.path}-${i}`} className="flex items-center gap-2 text-xs border-b border-slate-100 dark:border-slate-900 py-1">
                            <span className={`px-1.5 rounded text-[11px] ${it.layer === "L2" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300" : it.layer === "L0" ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"}`}>{it.layer}</span>
                            <span className="font-mono truncate flex-1" title={it.path}>{it.title}</span>
                            <span className="text-slate-400">{it.ts ? new Date(it.ts).toLocaleString("zh-CN", { hour12: false }) : "?"}</span>
                            {(it.layer === "L1" || it.layer === "L2") && (
                              memoryArmed === it.path ? (
                                <span className="flex gap-1 items-center">
                                  <span className="text-amber-600 dark:text-amber-400">确认遗忘？</span>
                                  <button
                                    onClick={() => { forgetMemoryItem(memory.slug, it.path); setMemoryArmed(null); }}
                                    className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[11px]"
                                  >
                                    确认
                                  </button>
                                  <button onClick={() => setMemoryArmed(null)} className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-[11px]">取消</button>
                                </span>
                              ) : (
                                <button onClick={() => setMemoryArmed(it.path)} className="px-1.5 py-0.5 rounded border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-[11px]">遗忘</button>
                              )
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            {panel === "usage" && (
              <>
                {usageErr && (
                  <div className="rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm" data-testid="usage-error">
                    {usageErr?.status === 403 ? (
                      <>无权读取——这不是你部署的 agent，仅部署者本人（或运维）可查看调用记录。</>
                    ) : (
                      <>调用记录读取失败（{String(usageErr?.message || usageErr)}）——这不是「没有调用」，请稍后再试。</>
                    )}
                  </div>
                )}
                {usage && (
                  <div className="space-y-3" data-testid={`usage-panel-${usage.slug}`}>
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
              </>
            )}
            {panel === "allowance" && allowance && (
              <div className="space-y-3" data-testid={`allowance-panel-${allowance.slug}`}>
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
                  <input aria-label="对话额度新上限（分钟，0=关闭）"
                    value={alwDraft}
                    onChange={(e) => setAlwDraft(e.target.value)}
                    inputMode="numeric"
                    placeholder="新上限（分钟，0=关闭）"
                    className="w-48 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                  />
                  <button disabled={alwBusy} className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-40">
                    {alwBusy ? "保存中…" : "保存"}
                  </button>
                  {alwNote && <span className="text-xs text-amber-600 dark:text-amber-400">{alwNote}</span>}
                </form>
                <div className="text-[11px] text-slate-400">一次性限额：访客对话按分钟实扣你的部署计费键，扣完即止、随时可调。</div>
              </div>
            )}
            {panel === "embed" && embedS && (
              <div className="space-y-3" data-testid={`embed-panel-${embedS.slug}`}>
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
                    className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-40"
                  >
                    {embedBusy ? "保存中…" : "保存"}
                  </button>
                  {embedNote && <span className="text-xs text-amber-600 dark:text-amber-400">{embedNote}</span>}
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">嵌入代码（贴进产品线页面；宿主上下文/身份递送见文档「嵌入车道」）：</div>
                  <pre className="overflow-x-auto rounded-lg bg-slate-100 dark:bg-slate-900 p-2 text-[11px] font-mono text-slate-600 dark:text-slate-300">{`<iframe src="${window.location.origin}/#/embed/${embedS.slug}?open=1"
  style="position:fixed;bottom:0;right:0;width:420px;height:640px;border:0;
  background:transparent;z-index:2147483000"
  allow="clipboard-write" title="助手"></iframe>`}</pre>
                  <div className="text-[11px] text-slate-400">
                    弹窗登录需浏览器允许该 iframe 弹窗（默认允许；若宿主加了 sandbox 需含 allow-popups）。
                    问询卡随对话自动出现；宿主若想让助手执行页面动作（如 navigate/refresh），在 init 消息里声明 <span className="font-mono">intents</span> 动词列表并监听 <span className="font-mono">wx-copilot-intent</span> 回结果——见文档「宿主意图」。
                  </div>
                </div>
              </div>
            )}
          </Drawer>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="deploy-panel">
        <h3 className="font-semibold">部署我的 agent <a href="#/collections" className="ml-2 text-xs font-normal text-accent dark:text-accent hover:underline" data-testid="collections-entry-link">我的集合 →</a></h3>
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
