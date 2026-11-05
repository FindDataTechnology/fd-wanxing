// Collections management (add-deploy-collections, M4③): the deployer's own
// collections — reference lists of packs with optional per-entry suggested
// config. One data model, two semantics live here: private = 组织分组,
// public = 可部署套装 (share link + one-click bundle deploy). Collections
// never execute anything — they organize and suggest.
import { useEffect, useMemo, useState } from "react";
import { authFetch, loginLogto, useAuth } from "../auth.js";
import { BundleDeployDialog } from "../components/BundleDeployDialog.jsx";

const RHYTHM_PRESETS = [
  { key: "", label: "不设（声明默认）" },
  { key: "15m", label: "每 15 分钟" },
  { key: "1h", label: "每小时" },
  { key: "daily", label: "每天 09:30" },
  { key: "custom", label: "自定义（JSON）" },
];

const EntryRow = ({ entry, agentsFor, onChange, onRemove }) => {
  const agents = agentsFor(entry.packId);
  const sc = entry.suggestedConfig ?? {};
  const setSc = (patch) => onChange({ ...entry, suggestedConfig: { ...sc, ...patch } });
  const rhythmKey = entry.__rhythmKey ?? (Array.isArray(sc.rhythm) ? (sc.rhythm.length === 1 && sc.rhythm[0].every === "15m" ? "15m" : sc.rhythm.length === 1 && sc.rhythm[0].every === "1h" ? "1h" : sc.rhythm.length === 1 && sc.rhythm[0].daily === "09:30" ? "daily" : "custom") : "");
  const inputCls = "px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono";
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 space-y-2" data-testid={`entry-row-${entry.packId}`}>
      <div className="flex gap-2 items-center flex-wrap text-xs">
        <span className="font-medium">{entry.packName ?? entry.packId}</span>
        {entry.category && <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">{entry.category}</span>}
        {entry.featured && <span className="text-amber-500">★</span>}
        {entry.inService && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 dark:bg-slate-800">在役</span>}
        <select
          value={entry.agentId ?? ""}
          onChange={(e) => onChange({ ...entry, agentId: e.target.value || undefined })}
          className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          data-testid={`entry-agent-${entry.packId}`}
        >
          <option value="">全部 serving agent</option>
          {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name ?? a.id}</option>)}
        </select>
        {entry.agentId && (
          <span className="text-[11px] text-slate-400">{(agents ?? []).find((a) => a.id === entry.agentId)?.modelWhitelist?.join(" · ") ?? "模型域：按计费键车道"}</span>
        )}
        <button onClick={onRemove} className="ml-auto px-2 py-0.5 rounded border border-rose-300 text-rose-600 dark:text-rose-300 text-xs">移除</button>
      </div>
      {entry.agentId && (
        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          <label className="space-y-0.5">
            <span className="text-slate-500">建议模型</span>
            <input value={sc.model ?? ""} onChange={(e) => setSc({ model: e.target.value || undefined })} placeholder="留空=声明默认"
              className={`${inputCls} w-full`} data-testid={`entry-model-${entry.packId}`} />
          </label>
          <label className="space-y-0.5">
            <span className="text-slate-500">建议预算（分钟）</span>
            <input value={sc.budgetMinutes ?? ""} onChange={(e) => setSc({ budgetMinutes: e.target.value === "" ? undefined : Number(e.target.value) })} inputMode="numeric" placeholder="1–120"
              className={`${inputCls} w-full`} data-testid={`entry-budget-${entry.packId}`} />
          </label>
          <label className="space-y-0.5">
            <span className="text-slate-500">建议节奏</span>
            <select
              value={rhythmKey}
              onChange={(e) => {
                const key = e.target.value;
                onChange({ ...entry, __rhythmKey: key, suggestedConfig: { ...sc, rhythm: key === "15m" ? [{ every: "15m" }] : key === "1h" ? [{ every: "1h" }] : key === "daily" ? [{ daily: "09:30" }] : key === "custom" ? (sc.rhythm ?? []) : undefined } });
              }}
              className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs w-full"
              data-testid={`entry-rhythm-${entry.packId}`}
            >
              {RHYTHM_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
        </div>
      )}
      {entry.agentId && rhythmKey === "custom" && (
        <textarea
          value={JSON.stringify(sc.rhythm ?? [])}
          onChange={(e) => {
            try { onChange({ ...entry, suggestedConfig: { ...sc, rhythm: JSON.parse(e.target.value) } }); } catch { /* 暂存非法 JSON——保存时后端拒 */ }
          }}
          rows={2} placeholder='[{"every":"30m","do":"巡检"}]' className={`${inputCls} w-full`}
          data-testid={`entry-rhythm-json-${entry.packId}`} />
      )}
    </div>
  );
};

export function CollectionsView() {
  const auth = useAuth();
  const token = auth.token;
  const [list, setList] = useState(null);
  const [listErr, setListErr] = useState("");
  const [draft, setDraft] = useState({ name: "", description: "", visibility: "private" });
  // detail editing state
  const [detail, setDetail] = useState(null); // { id, name, description, visibility, entries(resolved) }
  const [entryDraft, setEntryDraft] = useState([]); // editable rows (raw shape + resolved fields)
  const [dir, setDir] = useState(null); // directory source for the add picker
  const [mine, setMine] = useState(null); // my packs source
  const [pickerId, setPickerId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const loadList = () =>
    authFetch("/api/wanxing/v1/console/collections")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (setList(d), setListErr("")))
      .catch((e) => setListErr(String(e?.message || e)));

  useEffect(() => {
    if (token) loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || detail) return;
    // sources for the entry picker (directory + my packs), loaded lazily
    Promise.all([
      authFetch("/api/wanxing/v1/console/catalog/packs").then((r) => (r.ok ? r.json() : { packs: [] })).catch(() => ({ packs: [] })),
      authFetch("/api/wanxing/v1/console/my/packs").then((r) => (r.ok ? r.json() : { packs: [] })).catch(() => ({ packs: [] })),
    ]).then(([d, m]) => {
      setDir(d);
      setMine(m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, detail?.id]);

  const agentsFor = (packId) => {
    const row = [...(mine?.packs ?? []), ...(dir?.packs ?? [])].find((p) => p.id === packId);
    return row?.deployableAgents ?? [];
  };

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setNote("");
    try {
      const r = await authFetch("/api/wanxing/v1/console/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDraft({ name: "", description: "", visibility: "private" });
      loadList();
      openDetail(d.collection.id);
    } catch (err) {
      setNote(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const openDetail = (id) => {
    setNote("");
    authFetch(`/api/wanxing/v1/console/collections/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        setDetail(d.collection);
        setEntryDraft(d.collection.entries.map((x) => ({
          packId: x.packId, ...(x.agentId ? { agentId: x.agentId } : {}), ...(x.suggestedConfig ? { suggestedConfig: x.suggestedConfig } : {}),
          packName: x.packName, category: x.category, featured: x.featured, inService: x.inService,
        })));
      })
      .catch((e) => setNote(String(e?.message || e)));
  };

  const saveEntries = async () => {
    setNote("");
    setBusy(true);
    try {
      const clean = entryDraft.map(({ packName, category, featured, inService, __rhythmKey, ...raw }) => raw);
      const r = await authFetch(`/api/wanxing/v1/console/collections/${encodeURIComponent(detail.id)}/entries`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: clean }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      openDetail(detail.id);
      loadList();
      setNote("条目已保存");
    } catch (e) {
      setNote(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const saveMeta = async (patch) => {
    setNote("");
    const r = await authFetch(`/api/wanxing/v1/console/collections/${encodeURIComponent(detail.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setNote(d.error || `HTTP ${r.status}`);
    setDetail(d.collection);
    loadList();
  };

  // Delete with confirm + error state (wanxing-first-visitor 5.2): a failed
  // DELETE keeps the collection open with a retryable error note — it must
  // not silently close as if it had succeeded.
  const [delArmed, setDelArmed] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const remove = async () => {
    if (!delArmed) { setDelArmed(true); return; }
    setDelBusy(true);
    setNote("");
    try {
      const r = await authFetch(`/api/wanxing/v1/console/collections/${encodeURIComponent(detail.id)}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setNote(`删除失败：${d.error || `HTTP ${r.status}`}`);
        setDelArmed(false);
        return;
      }
      setDetail(null);
      setDelArmed(false);
      loadList();
    } catch (e) {
      setNote(`删除失败：${String(e?.message || e)}`);
      setDelArmed(false);
    } finally {
      setDelBusy(false);
    }
  };

  const addFromPicker = () => {
    if (!pickerId) return;
    if (entryDraft.some((x) => x.packId === pickerId && !x.agentId)) { setNote("该 pack 已整包在列"); return; }
    const row = [...(mine?.packs ?? []), ...(dir?.packs ?? [])].find((p) => p.id === pickerId);
    setEntryDraft((prev) => [...prev, {
      packId: pickerId, packName: row?.name ?? pickerId, category: row?.category, featured: row?.featured, inService: row?.deployed,
    }]);
    setPickerId("");
    setNote("");
  };

  const pickerOptions = useMemo(() => {
    const seen = new Set();
    const rows = [];
    for (const p of [...(mine?.packs ?? []), ...(dir?.packs ?? [])]) {
      if (!p.deployable || seen.has(p.id)) continue;
      seen.add(p.id);
      rows.push(p);
    }
    return rows;
  }, [mine, dir]);

  if (!token) {
    return (
      <div className="max-w-sm mx-auto mt-16 space-y-4">
        <h1 className="text-xl font-semibold">我的集合</h1>
        <button onClick={() => loginLogto().catch((e) => alert(String(e?.message || e)))}
          className="w-full px-3 py-2.5 rounded-lg bg-accent text-white text-sm">
          使用寻数账号登录（Logto）
        </button>
      </div>
    );
  }

  const shareUrl = detail?.visibility === "public" ? `${location.origin}/#/bundle/${detail.id}` : null;

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">我的集合</h1>
        <span className="text-xs text-slate-400">引用清单——组织分组（私有）与可部署套装（公开分享）；集合本身不执行任何东西。</span>
      </div>

      {listErr && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm" data-testid="collections-error">
          集合读取失败（{listErr}）——这不是「没有集合」，请稍后再试。
        </div>
      )}

      {!detail && (
        <>
          <form onSubmit={create} className="flex gap-2 items-center flex-wrap text-xs">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="集合名（如：研究流水线）"
              className="flex-1 min-w-48 px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" data-testid="collection-name-input" />
            <select value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value })}
              className="px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs">
              <option value="private">私有（组织分组）</option>
              <option value="public">公开（可部署套装）</option>
            </select>
            <button disabled={busy || !draft.name.trim()} className="px-3 py-2 rounded-lg bg-accent text-white text-xs disabled:opacity-40">
              新建集合
            </button>
          </form>
          {note && <div className="text-xs text-amber-600 dark:text-amber-400">{note}</div>}
          {list && (
            <div className="space-y-1" data-testid="collections-list">
              {list.collections.length === 0 && <div className="text-xs text-slate-500">还没有集合——建一个，把 pack 组织起来。</div>}
              {list.collections.map((c) => (
                <div key={c.id} className="flex gap-2 items-center text-xs">
                  <span className={`px-1.5 py-0.5 rounded font-mono ${c.visibility === "public" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>{c.visibility === "public" ? "套装" : "私有"}</span>
                  <button onClick={() => openDetail(c.id)} className="text-left hover:underline">{c.name}</button>
                  <span className="text-slate-400">{c.entries} 条 · {new Date(c.updatedAt).toLocaleString("zh-CN", { hour12: false })}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {detail && (
        <div className="space-y-4" data-testid="collection-detail">
          <div className="flex gap-2 items-center flex-wrap">
            <input
              value={detail.name}
              onChange={(e) => setDetail({ ...detail, name: e.target.value })}
              onBlur={(e) => e.target.value.trim() && saveMeta({ name: e.target.value.trim() })}
              className="text-base font-semibold bg-transparent border-b border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:border-slate-400 outline-none"
              data-testid="collection-title"
            />
            <select value={detail.visibility} onChange={(e) => saveMeta({ visibility: e.target.value })}
              className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs">
              <option value="private">私有（组织分组）</option>
              <option value="public">公开（可部署套装）</option>
            </select>
            <button onClick={() => { setDetail(null); setNote(""); }} className="ml-auto px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">← 返回列表</button>
            {delArmed ? (
              <span className="flex items-center gap-1" data-testid="collection-delete-confirm">
                <span className="text-xs text-rose-500">确认删除「{detail.name}」？</span>
                <button onClick={remove} disabled={delBusy} className="px-2 py-1 rounded bg-rose-600 text-white text-xs disabled:opacity-40">{delBusy ? "删除中…" : "确认删除"}</button>
                <button onClick={() => setDelArmed(false)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">取消</button>
              </span>
            ) : (
              <button onClick={remove} data-testid="collection-delete" className="px-2 py-1 rounded border border-rose-300 text-rose-600 dark:text-rose-300 text-xs">删除集合</button>
            )}
          </div>
          {shareUrl && (
            <div className="flex gap-2 items-center text-xs" data-testid="collection-share">
              <span className="text-slate-500">分享链接：</span>
              <code className="truncate flex-1 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">{shareUrl}</code>
              <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700">复制</button>
              <a href={`#/bundle/${detail.id}`} target="_blank" rel="noreferrer" className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700">打开</a>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex gap-2 items-center flex-wrap text-xs">
              <span className="font-semibold">条目（{entryDraft.length}/20）</span>
              <select value={pickerId} onChange={(e) => setPickerId(e.target.value)}
                className="flex-1 min-w-56 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                data-testid="entry-picker">
                <option value="">+ 从我的 pack / 目录添加…</option>
                {pickerOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}（v{p.version}{p.deployed ? " · 在役" : ""}）</option>
                ))}
              </select>
              <button onClick={addFromPicker} disabled={!pickerId} className="px-2 py-1 rounded bg-accent text-white text-xs disabled:opacity-40">添加</button>
            </div>
            {entryDraft.length === 0 && <div className="text-xs text-slate-500">空集合——从上方添加 pack 引用。</div>}
            {entryDraft.map((entry, i) => (
              <EntryRow
                key={`${entry.packId}-${entry.agentId ?? ""}`}
                entry={entry}
                agentsFor={agentsFor}
                onChange={(next) => setEntryDraft((prev) => prev.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setEntryDraft((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
            <div className="flex gap-2 items-center">
              <button disabled={busy} onClick={saveEntries} className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-40">
                {busy ? "保存中…" : "保存条目"}
              </button>
              {note && <span className="text-xs text-amber-600 dark:text-amber-400" data-testid="collection-note">{note}</span>}
            </div>
          </div>

          {detail.entries.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <div className="text-xs font-semibold">一键部署此套装</div>
              <BundleDeployDialog collectionId={detail.id} entries={detail.entries.length} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
