// The bundle-deploy dialog (add-deploy-collections, M4③b): one billing key,
// optional notify channel, per-entry verdicts on submit. Shared by the
// collections management view (owner) and the public bundle share page
// (signed-in visitor) — the same endpoint, the same honesty.
import { useState } from "react";
import { authFetch } from "../auth.js";

export function BundleDeployDialog({ collectionId, entries, onDone = () => {} }) {
  const [billingKey, setBillingKey] = useState("");
  const [notifyChannel, setNotifyChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState("");
  const inputCls = "px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono";

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      const r = await authFetch(`/api/wanxing/v1/console/collections/${encodeURIComponent(collectionId)}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingKey, ...(notifyChannel ? { notifyChannel } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error?.message || d.error || `HTTP ${r.status}`);
      setResults(d);
      onDone(d);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const verdictTone = (v) =>
    v === "deployed"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : v === "skipped-in-service"
        ? "bg-slate-100 text-slate-500 dark:bg-slate-800"
        : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";

  return (
    <div className="space-y-2" data-testid="bundle-deploy-dialog">
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <label className="space-y-1">
          <span className="text-slate-500">计费键（你的 sub2api sk-…，全部条目共用）</span>
          <input type="password" value={billingKey} onChange={(e) => setBillingKey(e.target.value)} placeholder="sk-…"
            className={`${inputCls} w-full`} data-testid="bundle-billing-key" />
          <span className="block text-[11px] text-slate-400">
            在 <a href="https://token.finddatatech.cloud" target="_blank" rel="noreferrer" className="underline">计费面板</a> 创建；套装内每个条目的回合按分钟实扣此键。
          </span>
        </label>
        <label className="space-y-1">
          <span className="text-slate-500">通知通道（可空，全部条目共用）</span>
          <input value={notifyChannel} onChange={(e) => setNotifyChannel(e.target.value)} placeholder="如 fd-ops"
            className={`${inputCls} w-full`} data-testid="bundle-notify" />
        </label>
      </div>
      {err && <div className="text-xs text-amber-600 dark:text-amber-400" data-testid="bundle-deploy-error">{err}</div>}
      <button
        disabled={busy || !billingKey}
        onClick={submit}
        className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-40"
        data-testid="bundle-deploy-submit"
      >
        {busy ? "部署中…" : `一键部署 ${entries} 个条目`}
      </button>
      {results && (
        <div className="space-y-1 text-xs" data-testid="bundle-deploy-results">
          {(results.results ?? []).map((r, i) => (
            <div key={i} className="flex gap-2 items-center flex-wrap">
              <span className={`px-1.5 py-0.5 rounded font-mono ${verdictTone(r.verdict)}`}>
                {r.verdict === "deployed" ? "已部署" : r.verdict === "skipped-in-service" ? "在役跳过" : r.verdict === "refused" ? "被拒" : "错误"}
              </span>
              <span className="font-mono text-slate-400">{r.packId}{r.agentId ? "/" + r.agentId : ""}</span>
              {r.slugs?.length > 0 && (
                <a href={`#/chat/${encodeURIComponent(r.slugs[0])}`} className="text-accent dark:text-accent hover:underline">{r.slugs[0]}</a>
              )}
              {r.error && <span className="text-amber-600 dark:text-amber-400 truncate" title={typeof r.error === "string" ? r.error : JSON.stringify(r.error)}>{typeof r.error === "string" ? r.error : JSON.stringify(r.error)}</span>}
            </div>
          ))}
          {results.deployedSlugs?.length > 0 && results.results?.some((r) => r.verdict !== "deployed") && (
            <div className="text-[11px] text-slate-400">部分成功——被拒/跳过的条目不回滚已上线者；修正后可重跑（部署幂等）。</div>
          )}
          {results.deployedSlugs?.length === 0 && (
            <div className="text-[11px] text-slate-400">本轮没有新上线的条目。</div>
          )}
        </div>
      )}
    </div>
  );
}
