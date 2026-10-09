// Public catalog: the facade's catalog API with slice-① pagination, plus a
// client-side filter over the loaded page. Error states are explicit — an
// unreachable catalog never renders as "no agents".
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 12;

export function CatalogView() {
  const [page, setPage] = useState(1);
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    fetch(`/api/wanxing/v1/agents?page=${page}&page_size=${PAGE_SIZE}`)
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
  }, [page]);

  const total = doc?.total ?? doc?.agents?.length ?? 0;
  const pages = doc?.page_size ? Math.max(1, Math.ceil(total / doc.page_size)) : 1;
  const agents = useMemo(() => {
    const list = doc?.agents ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((a) =>
      [a.name, a.description, a.slug, ...(a.tags ?? [])].join(" ").toLowerCase().includes(needle),
    );
  }, [doc, q]);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">公共目录</h1>
      <p className="text-sm text-slate-500 mb-4">
        调用键持有者可经 A2A 协议直接对话任一公开 agent——如何开始见<a className="underline" href="#/docs">文档</a>。
      </p>
      <div className="flex items-center gap-3 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索当前页：名称 / 描述 / slug / 标签"
          className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
        />
        <span className="text-sm text-slate-500">{loading ? "加载中…" : `共 ${total} 个`}</span>
      </div>

      {err ? (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm">
          目录暂不可用（{err}）——这不是「没有 agent」，请稍后再试。
        </div>
      ) : agents.length === 0 && !loading ? (
        <div className="text-sm text-slate-500 px-1 py-8">当前页没有匹配的 agent。</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <div key={a.slug} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">{a.name ?? a.slug}</span>
                <span className="text-xs text-slate-400">v{a.version ?? "?"}</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 flex-1">{a.description ?? "—"}</p>
              <div className="flex flex-wrap gap-1">
                {(a.tags ?? []).map((t) => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{t}</span>
                ))}
              </div>
              <code className="text-xs text-slate-400 truncate" title={a.slug}>{a.slug}</code>
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
          ))}
        </div>
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
