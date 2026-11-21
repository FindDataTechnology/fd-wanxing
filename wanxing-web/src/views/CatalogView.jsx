// Public catalog: the facade's catalog API with slice-① pagination, M4②
// server-side facets (search/category/featured through query params), and
// the curation presentation — category chips from the facets summary, a
// featured leading group, per-card category/activity badges. Cluster members
// (add-cluster-catalog-grouping) render grouped under their cluster header
// within each presentation group; the header narrows the catalog to the
// cluster. Error states are explicit — an unreachable catalog never renders
// as "no agents".
import { useEffect, useMemo, useState } from "react";
import { factOf, badgeFor } from "../status-facts.js";
import { label } from "../labels.js";

const PAGE_SIZE = 12;

// Split a page into render segments: runs of ungrouped agents stay flat in
// their order; entries carrying a cluster marker collect under one segment
// per cluster at the position of the first member, default members first.
// Grouping is a presentation over THIS page — a cluster split across a page
// boundary shows a partial group, and the header says so.
export function segmentsOf(list) {
  const segs = [];
  const byId = new Map();
  for (const a of list ?? []) {
    const c = a?.cluster;
    if (c?.id) {
      let seg = byId.get(c.id);
      if (!seg) {
        seg = { kind: "cluster", id: c.id, name: c.name, members: c.members, url: c.url ?? null, items: [] };
        byId.set(c.id, seg);
        segs.push(seg);
      }
      seg.items.push(a);
      if (!seg.url && c.url) seg.url = c.url;
    } else {
      const last = segs[segs.length - 1];
      if (last && last.kind === "flat") last.items.push(a);
      else segs.push({ kind: "flat", items: [a] });
    }
  }
  const rank = (a) => (a.cluster?.role === "default" ? 0 : 1);
  for (const s of segs) if (s.kind === "cluster") s.items.sort((x, y) => rank(x) - rank(y));
  return segs;
}

// Instance status (close-wanxing-domain-linkage 5.1; unify-wanxing-surface-language D1/D2):
// the marker now comes from the cross-surface fact table, so the catalog, the agent
// detail, the fleet card and the ops board cannot disagree. Exactly one badge per
// entry — a failing agent no longer wears an "在役"-looking chip beside its failure.
// Exported so the mapping itself is testable.
export const statusBadgeFor = (agent) =>
  badgeFor(factOf({ status: agent?.status, health: agent?.health }));

/** True when every entry on the page reports an unknown status (page-level staleness). */
export function allStatusesUnknown(agents = []) {
  return agents.length > 0 && agents.every((a) => a.status === "unknown");
}

/**
 * One catalog card. Exported so the no-examples / label rendering is testable without a fetch.
 *
 * Four elements at most (wanxing-first-impression): the name line, ONE primary
 * status fact, at most one curation signal, one entry action. Everything else
 * the card used to carry (chatability chip, cluster chip, activity chip, tag
 * wall, slug fold, filler sentence) is either demoted to quiet text or gone —
 * because a card where six colored chips shout equally tells a scanning
 * visitor nothing. Zero-turn and no-skill states render nothing rather than a
 * placeholder: blank is honest information.
 */
export function AgentCard({ agent: a }) {
  const fact = statusBadgeFor(a);
  const paused = fact.fact === "paused";
  // The entry states the truth: chat only when chatable AND not paused;
  // otherwise the detail view (which explains why).
  const chatEntry = a.chatable === true && !paused;
  const examples = a.examples ?? [];
  const skills = a.skills ?? [];
  return (
    <div data-testid={`agent-card-${a.slug}`} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <a href={`#/agent/${encodeURIComponent(a.slug)}`} data-testid={`agent-detail-link-${a.slug}`} className="font-semibold hover:underline" title="查看详情">
          {a.name ?? a.slug}
        </a>
        <span className="text-xs text-slate-400">v{a.version ?? "?"}</span>
        {a.status && (
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${fact.cls}`}
            data-testid={`status-badge-${a.slug}`}
            title={a.status_as_of ? `状态取自 ${a.status_as_of}` : undefined}
          >
            {fact.label}
          </span>
        )}
        {a.category && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" data-testid={`category-badge-${a.slug}`}>
            {label(a.category)}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400 flex-1">{a.description ?? "—"}</p>
      {/* Secondary signals as quiet one-line text — visible, but never another
          colored chip competing with the status fact. */}
      {(a.turns7d > 0 || a.cluster || chatEntry) && (
        <p className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-0.5" data-testid={`meta-${a.slug}`}>
          {a.turns7d > 0 && <span>近 7 天 {a.turns7d} 回合</span>}
          {a.cluster && <span>{a.cluster.role === "default" ? "集群默认成员" : "集群可选成员"}</span>}
          {chatEntry && <span>可对话</span>}
        </p>
      )}
      {examples.length > 0 && (
        <div className="flex flex-col gap-1" data-testid={`examples-${a.slug}`}>
          {examples.slice(0, 3).map((ex, i) => (
            <a
              key={i}
              href={chatEntry ? `#/chat/${encodeURIComponent(a.slug)}?q=${encodeURIComponent(ex)}` : undefined}
              className={`text-left text-xs px-2 py-1 rounded-lg border ${chatEntry ? "border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800" : "border-slate-200 dark:border-slate-800 text-slate-400 cursor-default"}`}
              title={chatEntry ? "点击开始这段对话" : "该 agent 暂未开放访客对话"}
            >
              试问 · {ex}
            </a>
          ))}
        </div>
      )}
      {/* Skills fold only exists when there ARE skills; the slug lives in the
          detail view and its copy button (it is an integration identifier, not
          card content). */}
      {skills.length > 0 && (
        <details className="text-xs text-slate-500" data-testid={`skills-${a.slug}`}>
          <summary className="cursor-pointer select-none">技能</summary>
          <ul className="mt-1 list-disc pl-4">
            {skills.map((sk, i) => (
              <li key={i}>{typeof sk === "string" ? sk : sk?.name ?? sk?.id}</li>
            ))}
          </ul>
        </details>
      )}
      {/* Outlined, not filled: 19 filled red buttons on one page would spend
          the whole accent budget on repetition. The single filled primary
          action belongs to the detail page, where there is exactly one. */}
      <a
        href={chatEntry ? `#/chat/${encodeURIComponent(a.slug)}` : `#/agent/${encodeURIComponent(a.slug)}`}
        data-testid={`entry-cta-${a.slug}`}
        className={`mt-1 inline-block text-center px-3 py-1.5 rounded-lg text-xs border ${chatEntry ? "border-accent text-accent hover:bg-accent-wash dark:hover:bg-accent-wash" : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}
        title={chatEntry ? "开始对话" : "查看详情"}
      >
        {chatEntry ? "对话" : "看详情"}
      </a>
    </div>
  );
}

export function CatalogView() {
  const [page, setPage] = useState(1);
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  // M4②: the search box queries the SERVER (debounced) — the whole catalog,
  // not the loaded page. Chips come from the facets summary.
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [featured, setFeatured] = useState(false);
  // Cluster narrowing: { id, name } or null; the name only labels the chip.
  const [cluster, setCluster] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
      facets: "1",
      // 活跃度顺序（sharpen-wanxing-first-impression）：精选 → 在役 → 尚无调用。
      // 排序在服务端、分页之前完成，所以翻页沿同一顺序。
      sort: "activity",
      ...(q ? { q } : {}),
      ...(category ? { category } : {}),
      ...(featured ? { featured: "1" } : {}),
      ...(cluster ? { cluster: cluster.id } : {}),
    });
    fetch(`/api/wanxing/v1/agents?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`catalog HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => live && setDoc(d))
      .catch((e) => live && setErr(String(e?.message || e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [page, q, category, featured, cluster]);

  const total = doc?.total ?? doc?.agents?.length ?? 0;
  // Page-level staleness (5.2): when EVERY entry reports an unknown status the
  // page says so once, carrying the snapshot instant, instead of presenting a
  // uniformly healthy-looking board.
  const agentsOnPage = doc?.agents ?? [];
  const allUnknown = allStatusesUnknown(agentsOnPage);
  const staleAsOf = agentsOnPage.find((a) => a.status_as_of)?.status_as_of ?? null;
  const pages = doc?.page_size ? Math.max(1, Math.ceil(total / doc.page_size)) : 1;
  const facets = doc?.facets ?? null;
  const pickCategory = (c) => {
    setCategory(c);
    setFeatured(false);
    setCluster(null);
    setPage(1);
  };
  const pickFeatured = () => {
    setFeatured((f) => !f);
    setCategory("");
    setCluster(null);
    setPage(1);
  };
  const pickCluster = (id, name) => {
    setCluster(id ? { id, name } : null);
    setCategory("");
    setFeatured(false);
    setPage(1);
  };

  // The featured leading group (精选) renders ahead of the rest within the
  // current page — the curation signal's presentation form (M4②).
  const { featuredAgents, restAgents } = useMemo(() => {
    const list = doc?.agents ?? [];
    const f = list.filter((a) => a.featured === true);
    return { featuredAgents: f, restAgents: list.filter((a) => a.featured !== true) };
  }, [doc]);


  // A presentation group (featured / rest) rendered as segments: flat runs
  // in a grid, each cluster under its own header. The header's count is
  // honest about pagination — members on this page over declared members.
  const renderSegments = (list) =>
    segmentsOf(list).map((seg, i) => {
      if (seg.kind === "flat") {
        return (
          <div key={`flat-${i}`} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-4">{seg.items.map((a) => <AgentCard key={a.slug} agent={a} />)}</div>
        );
      }
      const defaults = seg.items.filter((a) => a.cluster?.role === "default").length;
      const optionals = seg.items.length - defaults;
      return (
        <div
          key={`cluster-${seg.id}`}
          data-testid={`cluster-group-${seg.id}`}
          className="rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50/40 dark:bg-violet-950/20 p-3 mb-4"
        >
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className="text-xs px-1.5 py-0.5 rounded bg-violet-600 text-white">集群</span>
            <span className="font-semibold" data-testid={`cluster-name-${seg.id}`}>{seg.name}</span>
            <span className="text-xs text-slate-500" data-testid={`cluster-count-${seg.id}`}>
              {seg.items.length} / {seg.members} 在本页 · 默认 {defaults} · 可选 {optionals}
            </span>
            {cluster?.id !== seg.id && (
              <button
                onClick={() => pickCluster(seg.id, seg.name)}
                data-testid={`cluster-filter-${seg.id}`}
                className="text-xs underline text-violet-700 dark:text-violet-300"
              >
                只看这个集群
              </button>
            )}
          </div>
          {seg.url ? (
            <div className="flex items-center gap-2 mb-2 text-xs" data-testid={`cluster-endpoint-${seg.id}`}>
              <a href="#/docs" className="text-violet-700 dark:text-violet-300 underline">集群调用</a>
              <code className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-900 font-mono break-all">{seg.url}</code>
              <button
                onClick={() => navigator.clipboard?.writeText(seg.url)}
                data-testid={`cluster-copy-${seg.id}`}
                className="px-1.5 py-0.5 rounded border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300"
              >
                复制
              </button>
            </div>
          ) : (
            <div className="mb-2 text-xs text-slate-400">尚不可整体调用——至少需要一个默认成员在役。</div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{seg.items.map((a) => <AgentCard key={a.slug} agent={a} />)}</div>
        </div>
      );
    });

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">公共目录</h1>
      <p className="text-sm text-slate-500 mb-4">
        调用键持有者可经 A2A 协议直接对话任一公开 agent——如何开始见<a className="underline" href="#/docs">文档</a>。
      </p>
      <div className="flex items-center gap-3 mb-3">
        <input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="搜索全目录：名称 / 描述 / slug / 标签"
          data-testid="catalog-search"
          className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
        />
        <span className="text-sm text-slate-500" data-testid="catalog-total">{loading ? "读取中…" : `共 ${total} 个`}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="catalog-chips">
        <button
          onClick={() => pickCategory("")}
          className={`text-xs px-2.5 py-1 rounded-full border ${!category && !featured && !cluster ? "bg-accent text-white border-transparent" : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"}`}
          data-testid="chip-all"
        >
          全部{facets ? ` ${facets.total}` : ""}
        </button>
        <button
          onClick={pickFeatured}
          className={`text-xs px-2.5 py-1 rounded-full border ${featured ? "bg-amber-500 text-white border-transparent" : "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"}`}
          data-testid="chip-featured"
        >
          ★ 精选{facets ? ` ${facets.featured}` : ""}
        </button>
        {(facets?.categories ?? []).map((c) => (
          <button
            key={c.name}
            onClick={() => pickCategory(category === c.name ? "" : c.name)}
            className={`text-xs px-2.5 py-1 rounded-full border ${category === c.name ? "bg-sky-600 text-white border-transparent" : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"}`}
            data-testid={`chip-${c.name}`}
          >
            {label(c.name)} {c.count}
          </button>
        ))}
        {cluster && (
          <button
            onClick={() => pickCluster(null)}
            className="text-xs px-2.5 py-1 rounded-full border bg-violet-600 text-white border-transparent"
            data-testid="chip-cluster"
            title="清除集群筛选"
          >
            集群：{cluster.name} ×
          </button>
        )}
        {!cluster && facets?.clusters > 0 && (
          <span className="text-xs text-slate-400" data-testid="facets-clusters">含 {facets.clusters} 个集群</span>
        )}
      </div>

      <p className="text-xs text-slate-400 px-1 mb-2" data-testid="catalog-scope">
        这里列出<strong>当前已部署、对外服务</strong>的 agent（已部署实例视图）——不是功能集市场，
        未部署的包不会出现在这里。
      </p>

      <p className="text-xs text-slate-400 px-1 mb-2" data-testid="catalog-ordering">
        按活跃度排序：精选 → 在役 → 尚无调用。
      </p>

      {allUnknown && (
        <div className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-2 mb-3 text-xs text-slate-600 dark:text-slate-300" data-testid="catalog-stale-notice">
          实例状态暂不可得（快照时间 {staleAsOf ?? "未知"}）——下列条目仍可查看，但状态一律显示为「状态未知」。
        </div>
      )}

      {err ? (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm">
          目录暂不可用（{err}）——这不是「没有 agent」，请稍后再试。
        </div>
      ) : featuredAgents.length + restAgents.length === 0 && !loading ? (
        <div className="text-sm text-slate-500 px-1 py-8" data-testid="catalog-empty">没有匹配的 agent——换个关键词或清除筛选。</div>
      ) : (
        <>
          {featuredAgents.length > 0 && (
            <div className="mb-5" data-testid="featured-group">
              <div className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-2">★ 精选</div>
              {renderSegments(featuredAgents)}
            </div>
          )}
          {restAgents.length > 0 && (
            <div className={featuredAgents.length > 0 ? "pt-1 border-t border-slate-200 dark:border-slate-800" : ""}>
              {featuredAgents.length > 0 && <div className="text-sm font-semibold text-slate-500 mt-3 mb-2">其余</div>}
              {renderSegments(restAgents)}
            </div>
          )}
        </>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-slate-500">第 {page} / {pages} 页</span>
          <button
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
