// Public catalog: the facade's catalog API with slice-① pagination, M4②
// server-side facets (search/category/featured through query params), and
// the curation presentation — category chips from the facets summary, a
// featured leading group, per-card category/activity badges. Error states
// are explicit — an unreachable catalog never renders as "no agents".
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 12;

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
      ...(q ? { q } : {}),
      ...(category ? { category } : {}),
      ...(featured ? { featured: "1" } : {}),
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
  }, [page, q, category, featured]);

  const total = doc?.total ?? doc?.agents?.length ?? 0;
  const pages = doc?.page_size ? Math.max(1, Math.ceil(total / doc.page_size)) : 1;
  const facets = doc?.facets ?? null;
  const pickCategory = (c) => {
    setCategory(c);
    setFeatured(false);
    setPage(1);
  };
  const pickFeatured = () => {
    setFeatured((f) => !f);
    setCategory("");
    setPage(1);
  };

  // The featured leading group (精选) renders ahead of the rest within the
  // current page — the curation signal's presentation form (M4②).
  const { featuredAgents, restAgents } = useMemo(() => {
    const list = doc?.agents ?? [];
    const f = list.filter((a) => a.featured === true);
    return { featuredAgents: f, restAgents: list.filter((a) => a.featured !== true) };
  }, [doc]);

  const card = (a) => (
    <div key={a.slug} data-testid={`agent-card-${a.slug}`} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-semibold">{a.name ?? a.slug}</span>
        <span className="text-xs text-slate-400">v{a.version ?? "?"}</span>
        {a.chatable && <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">可对话</span>}
        {a.category && <span className="text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" data-testid={`category-badge-${a.slug}`}>{a.category}</span>}
        {a.turns7d > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" data-testid={`activity-badge-${a.slug}`}>
            近 7 天 {a.turns7d} 回合
          </span>
        )}
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400 flex-1">{a.description ?? "—"}</p>
      {(a.examples ?? []).length > 0 && (
        <div className="flex flex-col gap-1" data-testid={`examples-${a.slug}`}>
          {(a.examples ?? []).slice(0, 3).map((ex, i) => (
            <a
              key={i}
              href={a.chatable ? `#/chat/${encodeURIComponent(a.slug)}?q=${encodeURIComponent(ex)}` : undefined}
              className={`text-left text-xs px-2 py-1 rounded-lg border ${a.chatable ? "border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800" : "border-slate-200 dark:border-slate-800 text-slate-400 cursor-default"}`}
              title={a.chatable ? "点击开始这段对话" : "该 agent 暂未开放访客对话"}
            >
              试问 · {ex}
            </a>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {(a.tags ?? []).map((t) => (
          <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{t}</span>
        ))}
      </div>
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer select-none">技能与 slug</summary>
        <ul className="mt-1 list-disc pl-4">
          {(a.skills ?? []).length > 0 ? (a.skills ?? []).map((sk, i) => (
            <li key={i}>{typeof sk === "string" ? sk : sk?.name ?? sk?.id}</li>
          )) : <li>（未声明）</li>}
        </ul>
        <code className="block mt-1 text-slate-400 truncate" title={a.slug}>{a.slug}</code>
      </details>
      {a.chatable && (
        <a
          href={`#/chat/${encodeURIComponent(a.slug)}`}
          data-testid={`chat-cta-${a.slug}`}
          className="mt-1 inline-block text-center px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs"
        >
          对话
        </a>
      )}
    </div>
  );

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
        <span className="text-sm text-slate-500" data-testid="catalog-total">{loading ? "加载中…" : `共 ${total} 个`}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="catalog-chips">
        <button
          onClick={() => pickCategory("")}
          className={`text-xs px-2.5 py-1 rounded-full border ${!category && !featured ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-transparent" : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"}`}
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
            {c.name} {c.count}
          </button>
        ))}
      </div>

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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{featuredAgents.map(card)}</div>
            </div>
          )}
          {restAgents.length > 0 && (
            <div className={featuredAgents.length > 0 ? "pt-1 border-t border-slate-200 dark:border-slate-800" : ""}>
              {featuredAgents.length > 0 && <div className="text-sm font-semibold text-slate-500 mt-3 mb-2">其余</div>}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{restAgents.map(card)}</div>
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
