// Agent detail view (wanxing-first-visitor 4.1): the catalog card's click-through.
// One catalog fetch reused for the entry (examples/turns7d/category/chatable ride
// the same shape the cards render); the A2A card endpoint is NOT used here so the
// detail and the grid can never disagree about fields. Non-chatable agents render
// their examples read-only with an honest reason, mirroring the grid's gray state.
import { useEffect, useState } from "react";

export function AgentDetailView({ focusSlug }) {
  const [agent, setAgent] = useState(null); // entry object once found
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    fetch("/api/wanxing/v1/agents?page_size=200")
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

  const copySlug = () => {
    navigator.clipboard?.writeText(focusSlug ?? "").then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
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

  return (
    <div className="space-y-6 text-sm leading-relaxed" data-testid={`agent-detail-${agent.slug}`}>
      <p className="text-xs"><a className="underline text-slate-500" href="#/catalog">← 目录</a></p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">{agent.name ?? agent.slug}</h1>
        <span className="text-xs text-slate-400">v{agent.version ?? "?"}</span>
        {agent.chatable && <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">可对话</span>}
        {agent.category && <span className="text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">{agent.category}</span>}
        {agent.cluster && <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">{agent.cluster.role === "default" ? "集群默认成员" : "集群可选成员"}{agent.cluster.name ? ` · ${agent.cluster.name}` : ""}</span>}
        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" data-testid="detail-activity">
          近 7 天 {agent.turns7d ?? 0} 回合
        </span>
      </div>
      <p className="text-slate-600 dark:text-slate-400">{agent.description ?? "—"}</p>

      <div className="flex flex-wrap items-center gap-2">
        {agent.chatable ? (
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
          onClick={copySlug}
          data-testid="detail-copy-slug"
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
          title="复制 agent slug（对接时的路由标识）"
        >
          {copied ? "已复制" : "复制 slug"}
        </button>
      </div>

      {(agent.examples ?? []).length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">试问示例</h2>
          <div className="flex flex-col gap-1.5" data-testid="detail-examples">
            {agent.examples.map((ex, i) => (
              <a
                key={i}
                href={agent.chatable ? `#/chat/${encodeURIComponent(agent.slug)}?q=${encodeURIComponent(ex)}` : undefined}
                className={`text-left text-xs px-3 py-1.5 rounded-lg border w-fit ${agent.chatable ? "border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800" : "border-slate-200 dark:border-slate-800 text-slate-400 cursor-default"}`}
                title={agent.chatable ? "点击开始这段对话" : "该 agent 暂未开放访客对话——示例仅作能力展示"}
              >
                试问 · {ex}
              </a>
            ))}
          </div>
          {!agent.chatable && (
            <p className="mt-1.5 text-xs text-slate-400">
              该 agent 未开放访客对话车道（未声明可对话或未配置访客额度）——API 调用不受影响，见<a className="underline" href="#/docs">对接文档</a>。
            </p>
          )}
        </section>
      )}

      {(agent.skills ?? []).length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">技能</h2>
          <ul className="list-disc pl-5 text-slate-600 dark:text-slate-400">
            {agent.skills.map((sk, i) => (
              <li key={i}>
                {typeof sk === "string" ? sk : sk?.name ?? sk?.id}
                {typeof sk === "object" && sk?.description ? <span className="text-slate-400"> — {sk.description}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(agent.tags ?? []).length > 0 && (
        <section className="flex flex-wrap gap-1">
          {agent.tags.map((t) => (
            <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{t}</span>
          ))}
        </section>
      )}

      <section className="text-xs text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800 pt-3">
        <span className="font-medium">对接</span>：slug
        <code className="ml-1 px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">{agent.slug}</code>
        ，A2A 路由
        <code className="ml-1 px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">/api/wanxing/v1/a2a/{agent.slug}</code>
        ——详见<a className="underline" href="#/docs">对接文档</a>。
      </section>
    </div>
  );
}
