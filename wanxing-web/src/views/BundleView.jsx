// The public bundle share page (add-deploy-collections, M4③b): a public
// collection's visitor view — resolved entries read-only for anonymous
// visitors; the signed-in deploy dialog for logged-in ones. Missing/private
// collections render an explicit not-found state, never an empty bundle.
import { useEffect, useState } from "react";
import { loginLogto, useAuth } from "../auth.js";
import { BundleDeployDialog } from "../components/BundleDeployDialog.jsx";
import { SkeletonCards } from "../components/Skeleton.jsx";

export function BundleView({ focusSlug: focusId } = {}) {
  const auth = useAuth();
  const token = auth.token;
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!focusId) return;
    let live = true;
    fetch(`/api/wanxing/v1/collections/${encodeURIComponent(focusId)}`)
      .then(async (r) => {
        if (r.status === 404) throw Object.assign(new Error("not-found"), { notFound: true });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => live && (setDoc(d), setErr("")))
      .catch((e) => live && setErr(e.notFound ? "not-found" : String(e?.message || e)));
    return () => {
      live = false;
    };
  }, [focusId]);

  if (!focusId || err === "not-found") {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center space-y-2" data-testid="bundle-notfound">
        <div className="text-2xl">🛖</div>
        <div className="text-sm text-slate-500">套装不存在或未公开——链接可能已失效。</div>
        <a href="#/catalog" className="text-accent dark:text-accent underline text-sm">去目录逛逛</a>
      </div>
    );
  }
  if (err) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-sm text-amber-600 dark:text-amber-400" data-testid="bundle-error">
        套装读取失败（{err}）——请稍后再试。
      </div>
    );
  }
  if (!doc) return <div className="mt-16"><SkeletonCards cards={1} /></div>;

  const c = doc.collection;
  return (
    <div className="max-w-3xl mx-auto space-y-5" data-testid="bundle-view">
      <div>
        <h1 className="text-xl font-semibold">{c.name}</h1>
        {c.description && <p className="text-sm text-slate-500 mt-1">{c.description}</p>}
        <p className="text-xs text-slate-400 mt-1">可部署套装 · {c.entries.length} 个条目 · 更新于 {new Date(c.updatedAt).toLocaleString("zh-CN", { hour12: false })}</p>
      </div>

      <div className="space-y-2">
        {c.entries.map((e, i) => (
          <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex gap-2 items-center flex-wrap text-xs" data-testid={`bundle-entry-${e.packId}`}>
            <span className="font-medium text-sm">{e.packName ?? e.packId}</span>
            {e.agentName && <span className="text-slate-500">{e.agentName}</span>}
            {e.category && <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">{e.category}</span>}
            {e.featured && <span className="text-amber-500">★</span>}
            {e.inService && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 dark:bg-slate-800">已在役</span>}
            {e.suggestedConfig && (
              <span className="text-slate-400">
                建议：{e.suggestedConfig.model ? `模型 ${e.suggestedConfig.model} · ` : ""}{e.suggestedConfig.budgetMinutes ? `预算 ${e.suggestedConfig.budgetMinutes} 分钟 · ` : ""}{e.suggestedConfig.rhythm ? "节奏已建议" : ""}
              </span>
            )}
          </div>
        ))}
      </div>

      {token ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="text-xs font-semibold">一键部署此套装（按你的计费键）</div>
          <BundleDeployDialog collectionId={c.id} entries={c.entries.length} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center space-y-2" data-testid="bundle-login-prompt">
          <div className="text-sm text-slate-500">登录后可用你自己的计费键一键部署整个套装。</div>
          <button onClick={() => loginLogto({ returnTo: `#/bundle/${c.id}` }).catch((e) => alert(String(e?.message || e)))}
            className="px-3 py-2 rounded-lg bg-accent text-white text-sm">
            使用寻数账号登录（Logto）
          </button>
        </div>
      )}
    </div>
  );
}
