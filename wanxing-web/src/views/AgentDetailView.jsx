// Agent detail view (wanxing-first-visitor 4.1): the catalog card's click-through.
// One catalog fetch reused for the entry (examples/turns7d/category/chatable ride
// the same shape the cards render); the A2A card endpoint is NOT used here so the
// detail and the grid can never disagree about fields. Non-chatable agents render
// their examples read-only with an honest reason, mirroring the grid's gray state.
//
// wanxing-first-impression 4.x: the page is organized as three parts — what it
// is / how it is doing now / how to reach it — and the reason a visitor cannot
// chat is stated in words rather than implied by a grayed control.
import { useEffect, useState } from "react";
import { factOf, badgeFor } from "../status-facts.js";
import { label, isTranslated } from "../labels.js";
import { WANXING_BASE } from "../components/A2aSample.jsx";

const DETAIL_PAGE_SIZE = 200;

// One copy-pasteable call for THIS agent: the shared sample writes
// <agentSlug>, which leaves the reader editing before it runs. Here the slug is
// already in the route (wanxing-first-impression 4.1).
// ── 三支柱（openspec unify-pillar-surfaces 4.3） ────────────────────────────
// The machine face already carries the contract facts: the catalog entry grew
// `toolFace` (per-role narrowed tool names) and `memory` (declared axes) in the
// same change, and both ride `entry.metadata` server-side. This page renders
// them — and nothing else. Two rules that are not cosmetic:
//
//   · Absent key reads as an explicit 「未声明」, never as a silently empty box.
//     The spec pins three states (有值 / 未声明 / 已声明未实例化); collapsing
//     "not declared" into "declared but empty" is the drift this change exists
//     to stop.
//   · No prose here. The charter text (`memory.guidance`) is deliberately not
//     part of the catalog payload, so there is nothing to render even if we
//     wanted to — keep it that way (anonymous face).
const AXIS_TITLES = { store: "存放", read: "读取", write: "写入", process: "加工" };

export function pillarSectionsOf(agent) {
  const face = agent?.toolFace && typeof agent.toolFace === "object" ? agent.toolFace : null;
  const mem = agent?.memory && typeof agent.memory === "object" ? agent.memory : null;

  const groups = face
    ? Object.entries(face).map(([server, tools]) => ({
        server,
        tools: Array.isArray(tools) ? tools.map(String) : [],
      }))
    : [];

  // 四轴白名单，不是「遍历所有键」：机器面已经剥过一次 guidance，但这一层
  // 不该依赖上游剥得对——任何未知键（章程原文、未来新增的散文字段）一律不渲染。
  const axes = [];
  for (const axis of ["store", "read", "write", "process"]) {
    const value = mem?.[axis];
    if (value === undefined) continue;
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) axes.push({ axis, key: `${axis}.${k}`, value: String(v) });
    } else {
      axes.push({ axis, key: axis, value: String(value) });
    }
  }

  return [
    {
      key: "toolkit",
      title: "工具面",
      state: groups.length > 0 ? "present" : "undeclared",
      groups,
      undeclaredText: "本包未声明岗位级工具收窄——工具面按包级 allowTools 生效。",
    },
    {
      key: "memory",
      title: "记忆",
      state: axes.length > 0 ? "present" : "undeclared",
      axes,
      // 只声明了章程、四轴全跟平台默认的包，机器面刻意不带 axes（无散文、
      // 不发空壳）——这里必须说清「未声明轴」不等于「没有记忆」。
      undeclaredText: "本包未声明记忆四轴——沿用平台默认（章程原文只在需要身份的面可见）。",
    },
  ];
}

function curlFor(slug) {
  return `curl -X POST "${WANXING_BASE}/api/wanxing/v1/a2a/${slug}" \\
  -H "Authorization: Bearer sk-xxxx" \\
  -H "Idempotency-Key: my-ticket-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0", "id": 1,
    "method": "message/send",
    "params": { "message": {
      "role": "user",
      "parts": [{ "kind": "text", "text": "你好" }]
    }}
  }'`;
}

// The embed surface for THIS agent. `copilot.js` resolves an agent by its LINE
// binding (data-line), not by slug — so a slug-addressed snippet would be a
// lie. The direct iframe route is the one契约 that is per-agent today (see
// docs: "直连 …/#/embed/<agentSlug> 仍然可用"), so that is what we print.
const embedFor = (slug) => `<iframe src="${WANXING_BASE}/#/embed/${slug}"\n        style="width:380px;height:560px;border:0" title="萬星助手"></iframe>`;

export function AgentDetailView({ focusSlug }) {
  const [agent, setAgent] = useState(null); // entry object once found
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    fetch(`/api/wanxing/v1/agents?page_size=${DETAIL_PAGE_SIZE}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`catalog HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!live) return;
        const hit = (d.agents ?? []).find((a) => a.slug === focusSlug);
        if (!hit) throw new Error("AGENT_NOT_FOUND");
        setAgent(hit);
      })
      .catch((e) => live && setErr(String(e?.message || e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [focusSlug]);

  const copy = (what, text) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(what);
        setTimeout(() => setCopied(""), 1500);
      },
      () => {},
    );
  };

  if (loading) {
    return (
      <div className="space-y-3" data-testid="agent-detail-loading">
        <div className="h-6 w-40 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
        <div className="h-4 w-full rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
        <div className="h-4 w-2/3 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
      </div>
    );
  }
  if (err || !agent) {
    return (
      <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm" data-testid="agent-detail-missing">
        没有找到这个 agent——它可能已下线或转入私有。
        <a className="ml-2 underline" href="#/catalog">回目录看看</a>
      </div>
    );
  }

  const fact = badgeFor(factOf({ status: agent.status, health: agent.health }));
  const pillars = pillarSectionsOf(agent);
  const paused = fact.fact === "paused";
  const chatEntry = agent.chatable === true && !paused;
  const examples = agent.examples ?? [];
  const skills = agent.skills ?? [];
  // Visibility in words (4.2): the visitor should never have to infer WHY the
  // chat entry is missing from a grayed-out button.
  const visibility = paused
    ? "已暂停：部署者停了这个 agent，恢复后访客才能对话。"
    : !agent.chatable
      ? "未对访客开放对话：部署者未开访客额度或平台补贴未开启。API 调用不受影响。"
      : "公开：可经 A2A 用你的调用键直接调用；访客对话需登录。";

  return (
    <div className="space-y-8 text-sm leading-relaxed" data-testid={`agent-detail-${agent.slug}`}>
      <p className="text-xs"><a className="underline text-slate-500" href="#/catalog">← 目录</a></p>

      {/* ── 1. 它是什么 ─────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">{agent.name ?? agent.slug}</h1>
          <span className="text-xs text-slate-400">v{agent.version ?? "?"}</span>
          {agent.category && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">{label(agent.category)}</span>
          )}
        </div>
        <p className="text-slate-600 dark:text-slate-400">{agent.description ?? "—"}</p>
        {(agent.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {agent.tags.map((t) => (
              <span
                key={t}
                className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                title={isTranslated(t) ? `标签：${t}` : undefined}
              >
                {label(t)}
              </span>
            ))}
          </div>
        )}
        {skills.length > 0 && (
          <div>
            <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">技能</h2>
            <ul className="list-disc pl-5 text-slate-600 dark:text-slate-400">
              {skills.map((sk, i) => (
                <li key={i}>
                  {typeof sk === "string" ? sk : sk?.name ?? sk?.id}
                  {typeof sk === "object" && sk?.description ? <span className="text-slate-400"> — {sk.description}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── 1.5 三支柱（unify-pillar-surfaces 4.3） ─────────────────── */}
      <section className="space-y-3" data-testid="detail-pillars">
        <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400">团队能力面</h2>
        {pillars.map((sec) => (
          <div key={sec.key} className="space-y-1.5" data-testid={`detail-${sec.key}`}>
            <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400">{sec.title}</h3>
            {sec.state === "undeclared" ? (
              <p className="text-xs text-slate-400" data-testid={`detail-${sec.key}-undeclared`}>{sec.undeclaredText}</p>
            ) : sec.key === "toolkit" ? (
              <div className="space-y-1">
                {sec.groups.map((g) => (
                  <div key={g.server} className="flex flex-wrap items-baseline gap-2">
                    <code className="text-xs font-mono text-slate-600 dark:text-slate-300">{g.server}</code>
                    <span className="text-xs text-slate-400">{g.tools.length} 个工具</span>
                    <span className="flex flex-wrap gap-1">
                      {g.tools.map((t) => (
                        <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">{t}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <dl className="flex flex-wrap gap-x-4 gap-y-1">
                {sec.axes.map((a) => (
                  <div key={a.key} className="flex items-baseline gap-1">
                    <dt className="text-xs text-slate-400">{AXIS_TITLES[a.axis] ?? a.axis}</dt>
                    <dd className="text-xs text-slate-600 dark:text-slate-300 font-mono">{a.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </section>

      {/* ── 2. 现在怎样 ─────────────────────────────────────────────── */}
      <section className="space-y-1.5" data-testid="detail-now">
        <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400">现在</h2>
        <div className="flex items-baseline gap-x-4 gap-y-1 flex-wrap">
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${fact.cls}`}
            data-testid="agent-detail-status"
            title={agent.status_as_of ? `状态取自 ${agent.status_as_of}` : undefined}
          >
            {fact.label}
          </span>
          <span className="text-slate-600 dark:text-slate-400" data-testid="detail-activity">近 7 天 {agent.turns7d ?? 0} 回合</span>
          {agent.cluster && (
            <span className="text-slate-500 dark:text-slate-400">
              {agent.cluster.role === "default" ? "集群默认成员" : "集群可选成员"}{agent.cluster.name ? ` · ${agent.cluster.name}` : ""}
            </span>
          )}
        </div>
        {agent.status_as_of && (
          <p className="text-xs text-slate-400">状态快照：{new Date(agent.status_as_of).toLocaleString("zh-CN", { hour12: false })}</p>
        )}
      </section>

      {/* ── 3. 怎么接 ───────────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="detail-how">
        <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400">怎么接</h2>

        <div className="flex flex-wrap items-center gap-2">
          {chatEntry ? (
            <a
              href={`#/chat/${encodeURIComponent(agent.slug)}`}
              data-testid="detail-chat-cta"
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm"
            >
              开始对话
            </a>
          ) : (
            <span className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400 text-sm" data-testid="detail-chat-closed">
              对话入口未开放
            </span>
          )}
          <button
            onClick={() => copy("slug", agent.slug)}
            data-testid="detail-copy-slug"
            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
            title="复制 agent slug（对接时的路由标识）"
          >
            {copied === "slug" ? "已复制" : "复制 slug"}
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="detail-visibility">{visibility}</p>

        {examples.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">试问示例</h3>
            <div className="flex flex-col gap-1.5" data-testid="detail-examples">
              {examples.map((ex, i) => (
                <a
                  key={i}
                  href={chatEntry ? `#/chat/${encodeURIComponent(agent.slug)}?q=${encodeURIComponent(ex)}` : undefined}
                  className={`text-left text-xs px-3 py-1.5 rounded-lg border w-fit ${chatEntry ? "border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800" : "border-slate-200 dark:border-slate-800 text-slate-400 cursor-default"}`}
                  title={chatEntry ? "点击开始这段对话" : "该 agent 暂未开放访客对话——示例仅作能力展示"}
                >
                  试问 · {ex}
                </a>
              ))}
            </div>
          </div>
        )}
        {/* No examples declared → no invented examples, no apology copy (4.3). */}

        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400">A2A 调用</h3>
            <button
              onClick={() => copy("curl", curlFor(agent.slug))}
              data-testid="detail-copy-curl"
              className="text-[11px] px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700"
            >
              {copied === "curl" ? "已复制" : "复制"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 text-slate-100 p-3 text-[11px] leading-relaxed">{curlFor(agent.slug)}</pre>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400">嵌入一行</h3>
            <button
              onClick={() => copy("embed", embedFor(agent.slug))}
              data-testid="detail-copy-embed"
              className="text-[11px] px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700"
            >
              {copied === "embed" ? "已复制" : "复制"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-[11px] leading-relaxed">{embedFor(agent.slug)}</pre>
        </div>
      </section>
    </div>
  );
}
