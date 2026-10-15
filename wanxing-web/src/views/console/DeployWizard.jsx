// ── Deployment wizard (add-deploy-wizard M4①; directory source M4②) ────────
// Moved verbatim from ConsoleView in the IA refactor (M4④ 前置) — the deploy
// panel's stepped flow. Draft state lives across steps; a refusal on the
// billing step keeps everything entered.
import { useState } from "react";

// ── Deployment wizard (add-deploy-wizard, M4①) ──────────────────────────────
//
// The deploy panel's stepped flow: pack → agents → per-agent config → billing
// & notification → result with the visibility close-out (host allowance +
// allowlist caller) brought forward from the management area. Every knob
// rides existing endpoints — this component is orchestration, not a new
// engine. Draft state lives across steps; a refusal on the billing step
// keeps everything entered (spec scenario).
const RHYTHM_PRESETS = [
  { key: "none", label: "不设节奏（按需唤醒）" },
  { key: "15m", label: "每 15 分钟", entries: [{ every: "15m" }] },
  { key: "1h", label: "每小时", entries: [{ every: "1h" }] },
  { key: "daily", label: "每天 09:30", entries: [{ daily: "09:30" }] },
  { key: "custom", label: "自定义（JSON 数组）" },
];
const STEP_LABELS = ["选包", "勾选 agent", "配置", "计费与通知"];

export function DeployWizard({ packs, loadMyPacks, authFetch }) {
  // M4②: the pack step's two sources — the author's own packs and the
  // deployable directory (console catalog pack list with in-service state).
  const [source, setSource] = useState("mine");
  const [dirPacks, setDirPacks] = useState(null);
  const [dirErr, setDirErr] = useState("");
  const [step, setStep] = useState(1);
  const [packId, setPackId] = useState(null);
  const [version, setVersion] = useState("");
  const [picked, setPicked] = useState(new Set());
  const [cfg, setCfg] = useState({}); // agentId → { model, budget, rhythmKey, rhythmJson }
  const [billingKey, setBillingKey] = useState("");
  const [notifyChannel, setNotifyChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null); // { version, rows: [{agentId, slug, share}] }
  const [alwDraft, setAlwDraft] = useState({});
  const [alwNote, setAlwNote] = useState({});
  const [callerEmail, setCallerEmail] = useState({});
  const [callerNote, setCallerNote] = useState({});
  // Deploy target (add-desktop-fleet-runner ③): cloud auto-placement, or one
  // of the deployer's paired desktop seats (ownership is re-verified
  // server-side; the seat grant rides the forward).
  const [seats, setSeats] = useState(null);
  const [target, setTarget] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch("/api/wanxing/v1/console/devices");
        if (r.ok) setSeats((await r.json()).devices ?? []);
        else setSeats([]);
      } catch { setSeats([]); }
    })();
  }, []);

  const sourcePacks = source === "mine" ? packs : (dirPacks?.packs ?? []);
  const pack = (source === "mine" ? packs : (dirPacks?.packs ?? []))?.find((p) => p.id === packId) ?? null;
  const agents = pack?.deployableAgents ?? [];
  const deployable = packs?.filter((p) => p.deployable) ?? [];
  const undeployable = packs?.filter((p) => !p.deployable) ?? [];

  const reset = () => {
    setStep(1);
    setSource("mine");
    setPackId(null);
    setVersion("");
    setPicked(new Set());
    setCfg({});
    setBillingKey("");
    setNotifyChannel("");
    setErr("");
    setResult(null);
    setAlwDraft({});
    setAlwNote({});
    setCallerEmail({});
    setCallerNote({});
  };

  const choosePack = (p) => {
    setPackId(p.id);
    setVersion("");
    setPicked(new Set((p.deployableAgents ?? []).map((a) => a.id)));
    setCfg(Object.fromEntries((p.deployableAgents ?? []).map((a) => [a.id, { model: "", budget: "", rhythmKey: "none", rhythmJson: "" }])));
    setErr("");
    setStep(2);
  };

  const toggleAgent = (id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      // Empty field = the dimension rides absent (declaration default); an
      // explicit clear (null) is NOT sent — a deploy's initial config never
      // carries clear semantics.
      const models = {};
      const budgets = {};
      const rhythms = {};
      for (const id of picked) {
        const c = cfg[id] ?? {};
        if (c.model?.trim()) models[id] = c.model.trim();
        if (c.budget?.trim()) budgets[id] = Number(c.budget);
        if (c.rhythmKey === "custom") {
          const text = (c.rhythmJson ?? "").trim();
          if (text) {
            try {
              rhythms[id] = JSON.parse(text);
            } catch {
              throw new Error(`「${agents.find((a) => a.id === id)?.name ?? id}」的节奏 JSON 解析失败——需是数组，如 [{"every":"1h"}]`);
            }
          }
        } else if (c.rhythmKey && c.rhythmKey !== "none") {
          const preset = RHYTHM_PRESETS.find((p) => p.key === c.rhythmKey);
          if (preset?.entries) rhythms[id] = preset.entries;
        }
      }
      const body = {
        ...(version ? { version: Number(version) } : {}),
        ...(target ? { runnerId: target } : {}),
        billingKey,
        ...(notifyChannel ? { notifyChannel } : {}),
        agents: [...picked],
        ...(Object.keys(models).length ? { models } : {}),
        ...(Object.keys(budgets).length ? { budgets } : {}),
        ...(Object.keys(rhythms).length ? { rhythms } : {}),
      };
      const r = await authFetch(`/api/wanxing/v1/console/my/packs/${encodeURIComponent(packId)}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error?.message || d.error || `HTTP ${r.status}`);
      // Share cards for every deployed slug (typically one).
      const rows = await Promise.all((d.deployed ?? []).map(async (x) => {
        const sc = await authFetch(`/api/wanxing/v1/console/my/deployments/${encodeURIComponent(x.slug)}/share`).catch(() => null);
        const share = sc?.ok ? await sc.json().catch(() => null) : null;
        return { agentId: x.agentId, slug: x.slug, share };
      }));
      setResult({ version: d.version, rows });
      setStep(5);
      loadMyPacks();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const saveAllowance = async (slug) => {
    const limit = (alwDraft[slug] ?? "").trim() === "" ? 0 : Number(alwDraft[slug]);
    if (!Number.isInteger(limit) || limit < 0) return setAlwNote((p) => ({ ...p, [slug]: "额度必须是 ≥0 的整数（分钟）" }));
    const r = await authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/host-allowance`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limitMinutes: limit }),
    });
    const d = await r.json().catch(() => ({}));
    setAlwNote((p) => ({ ...p, [slug]: r.ok ? "已保存——下一回合起生效" : String(d?.error || `HTTP ${r.status}`) }));
    if (r.ok && result) {
      const sc = await authFetch(`/api/wanxing/v1/console/my/deployments/${encodeURIComponent(slug)}/share`).catch(() => null);
      const share = sc?.ok ? await sc.json().catch(() => null) : null;
      setResult({ ...result, rows: result.rows.map((x) => (x.slug === slug ? { ...x, share: share ?? x.share } : x)) });
    }
  };

  const addCaller = async (slug) => {
    const email = (callerEmail[slug] ?? "").trim();
    if (!email) return;
    const r = await authFetch(`/api/wanxing/v1/console/deployments/${encodeURIComponent(slug)}/callers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      setCallerEmail((p) => ({ ...p, [slug]: "" }));
      setCallerNote((p) => ({ ...p, [slug]: "已添加" }));
    } else {
      setCallerNote((p) => ({ ...p, [slug]: String(d?.error || `HTTP ${r.status}`) }));
    }
  };

  const loadDirectory = () => {
    setDirErr("");
    authFetch("/api/wanxing/v1/console/catalog/packs")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        setDirPacks(d);
      })
      .catch((e) => setDirErr(String(e?.message || e)));
  };

  const switchSource = (next) => {
    setSource(next);
    setPackId(null);
    setPicked(new Set());
    setCfg({});
    setErr("");
    if (next === "dir" && !dirPacks && !dirErr) loadDirectory();
  };

  const inputCls = "px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono";

  // Result step: share cards + the visibility close-out per deployed slug.
  if (step === 5 && result) {
    return (
      <div className="space-y-3" data-testid="wizard-result">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-mono text-xs">已部署 v{result.version}</span>
          <button onClick={reset} className="ml-auto px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">再部署一个</button>
        </div>
        {result.rows.map(({ agentId, slug, share }) => (
          <div key={slug} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
            <div className="text-xs space-y-1" data-testid="share-card">
              <div className="flex gap-2 items-center">
                <span className={`px-1.5 py-0.5 rounded font-mono ${share?.chatable ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"}`}>{share?.chatable == null ? "未知" : share.chatable ? "可对话" : "未开放"}</span>
                <code className="truncate flex-1">{share?.chatUrl ?? `#/chat/${slug}`}</code>
                <button onClick={() => navigator.clipboard?.writeText(share?.chatUrl ?? slug)} className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700">复制</button>
                <a href={share?.chatUrl ?? `#/chat/${slug}`} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700">打开</a>
              </div>
              <div className="text-slate-500">{share?.chatableReason ?? `agent：${agentId}`}</div>
              {share?.allowance && <div className="text-slate-500">部署者额度：余 {share.allowance.remainingMinutes}/{share.allowance.limitMinutes} 分钟</div>}
            </div>
            <div className="border-t border-slate-100 dark:border-slate-900 pt-2 space-y-1.5">
              <div className="text-[10px] text-slate-400">开放对话：设置一次性额度（访客对话按分钟实扣你的计费键，扣完即止）。</div>
              <div className="flex gap-2 items-center">
                <input
                  value={alwDraft[slug] ?? ""}
                  onChange={(e) => setAlwDraft((p) => ({ ...p, [slug]: e.target.value }))}
                  inputMode="numeric"
                  placeholder="分钟（0=关闭）"
                  className={`${inputCls} w-32`}
                  data-testid={`wizard-allowance-${slug}`}
                />
                <button onClick={() => saveAllowance(slug)} className="px-2 py-1 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs">设置额度</button>
                {alwNote[slug] && <span className="text-xs text-amber-600 dark:text-amber-400">{alwNote[slug]}</span>}
              </div>
              <div className="text-[10px] text-slate-400">API 调用者：把 email 加进允许清单（私有 agent 的调用门）。</div>
              <div className="flex gap-2 items-center">
                <input
                  value={callerEmail[slug] ?? ""}
                  onChange={(e) => setCallerEmail((p) => ({ ...p, [slug]: e.target.value }))}
                  placeholder="调用者邮箱"
                  className={`${inputCls} flex-1`}
                  data-testid={`wizard-caller-${slug}`}
                />
                <button onClick={() => addCaller(slug)} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs">添加调用者</button>
                {callerNote[slug] && <span className="text-xs text-amber-600 dark:text-amber-400">{callerNote[slug]}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid={`wizard-step-${step}`}>
      <div className="flex items-center gap-1 text-xs">
        {STEP_LABELS.map((label, i) => (
          <span key={label} className={`px-2 py-0.5 rounded-full ${step === i + 1 ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800 text-slate-500"}`}>
            {i + 1}. {label}
          </span>
        ))}
        {packId && (
          <button onClick={reset} className="ml-auto text-slate-400 hover:underline">关闭向导</button>
        )}
      </div>

      {step === 1 && (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            {[
              ["mine", "我的 pack"],
              ["dir", "目录可部署"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => switchSource(key)}
                className={`text-xs px-2.5 py-1 rounded-full border ${source === key ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-transparent" : "border-slate-300 dark:border-slate-700 text-slate-500"}`}
                data-testid={`wizard-source-${key}`}
              >
                {label}
              </button>
            ))}
          </div>
          {source === "mine" && (
            <div className="space-y-1">
              {deployable.map((p) => (
                <div key={p.id} className="flex gap-2 items-center flex-wrap">
                  <span className="px-1.5 py-0.5 rounded font-mono bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">可部署</span>
                  <button onClick={() => choosePack(p)} className="text-left hover:underline" data-testid={`wizard-pack-row-${p.id}`}>
                    {p.name}（v{p.version}{p.visibility === "private" ? " · 私有" : ""}）
                  </button>
                  <span className="text-slate-400">{(p.deployableAgents ?? []).map((a) => a.name ?? a.id).join("、") || "—"}</span>
                </div>
              ))}
              {undeployable.map((p) => (
                <div key={p.id} className="flex gap-2 items-center opacity-60">
                  <span className="px-1.5 py-0.5 rounded font-mono bg-slate-100 text-slate-500 dark:bg-slate-800">无契约</span>
                  <span className="text-left">{p.name}（v{p.version}）——pack 内没有带 serving 契约的 agent，不可部署为服务</span>
                </div>
              ))}
            </div>
          )}
          {source === "dir" && (
            <div className="space-y-1">
              {dirErr && <div className="text-xs text-amber-600 dark:text-amber-400">目录读取失败（{dirErr}）<button onClick={loadDirectory} className="underline ml-1">重试</button></div>}
              {!dirErr && !dirPacks && <div className="text-xs text-slate-500">目录加载中…</div>}
              {dirPacks && (dirPacks.packs ?? []).filter((p) => p.deployable).length === 0 && (
                <div className="text-xs text-slate-500">目录里暂无可部署的 pack（公开且含 serving 契约）。</div>
              )}
              {(dirPacks?.packs ?? []).filter((p) => p.deployable).map((p) => (
                <div key={p.id} className="flex gap-2 items-center flex-wrap">
                  {p.featured && <span className="text-amber-500" title="谦面策展精选">★</span>}
                  {p.category && <span className="px-1.5 py-0.5 rounded font-mono bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">{p.category}</span>}
                  {p.deployed ? (
                    <span className="text-left text-slate-500" title="已在役——升级/重部署走作者侧（「我的 pack」），本面不接管在役部署">
                      <span className="px-1.5 py-0.5 rounded font-mono bg-slate-100 text-slate-400 dark:bg-slate-800" data-testid={`wizard-dir-inservice-${p.id}`}>在役</span>{" "}
                      {p.name}（v{p.version}）
                    </span>
                  ) : (
                    <button onClick={() => choosePack(p)} className="text-left hover:underline" data-testid={`wizard-dir-row-${p.id}`}>
                      {p.name}（v{p.version}）
                    </button>
                  )}
                  <span className="text-slate-400">{(p.deployableAgents ?? []).map((a) => a.name ?? a.id).join("、") || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 2 && pack && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500">{pack.name} —— 勾选要部署为服务的 agent（至少一个）：</div>
          <div className="space-y-1">
            {agents.map((a) => (
              <label key={a.id} className="flex gap-2 items-center text-xs">
                <input
                  type="checkbox"
                  checked={picked.has(a.id)}
                  onChange={() => toggleAgent(a.id)}
                  data-testid={`wizard-agent-${a.id}`}
                />
                <span className="font-medium">{a.name ?? a.id}</span>
                <span className="text-slate-400 font-mono">{a.id}</span>
                {a.modelWhitelist && <span className="text-slate-400">模型域：{a.modelWhitelist.join(" · ")}</span>}
              </label>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              inputMode="numeric"
              placeholder={`版本（空=最新 v${pack.version}）`}
              className={`${inputCls} w-40`}
            />
            <button
              onClick={() => picked.size > 0 ? setStep(3) : setErr("至少勾选一个 agent 才能继续")}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs"
            >
              下一步：配置
            </button>
            {picked.size === 0 && <span className="text-xs text-amber-600 dark:text-amber-400">至少勾选一个 agent</span>}
            <button onClick={() => setStep(1)} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs">上一步</button>
          </div>
        </div>
      )}

      {step === 3 && pack && (
        <div className="space-y-3">
          {[...picked].map((id) => {
            const a = agents.find((x) => x.id === id) ?? { id };
            const c = cfg[id] ?? { model: "", budget: "", rhythmKey: "none", rhythmJson: "" };
            const set = (patch) => setCfg((p) => ({ ...p, [id]: { ...c, ...patch } }));
            return (
              <div key={id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                <div className="text-xs font-medium">{a.name ?? id} <span className="text-slate-400 font-mono">{id}</span></div>
                <div className="grid gap-2 sm:grid-cols-3 text-xs">
                  <label className="space-y-1">
                    <span className="text-slate-500">模型（留空=声明默认）</span>
                    <input
                      value={c.model}
                      onChange={(e) => set({ model: e.target.value })}
                      list={`wizard-lanes-${id}`}
                      placeholder={a.modelWhitelist?.[0] ?? "如 deepseek-v4-flash"}
                      className={`${inputCls} w-full`}
                      data-testid={`wizard-model-${id}`}
                    />
                    {a.modelWhitelist && (
                      <datalist id={`wizard-lanes-${id}`}>
                        {a.modelWhitelist.map((m) => <option key={m} value={m} />)}
                      </datalist>
                    )}
                    <span className="block text-[10px] text-slate-400">{a.modelWhitelist ? `合法模型：${a.modelWhitelist.join(" · ")}` : "未声明白名单——按计费键车道校验"}</span>
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-500">回合预算（分钟，留空=声明默认）</span>
                    <input
                      value={c.budget}
                      onChange={(e) => set({ budget: e.target.value })}
                      inputMode="numeric"
                      placeholder="如 20"
                      className={`${inputCls} w-full`}
                      data-testid={`wizard-budget-${id}`}
                    />
                    <span className="block text-[10px] text-slate-400">C1 硬停：每个回合的分钟上限</span>
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-500">工作节奏</span>
                    <select
                      value={c.rhythmKey}
                      onChange={(e) => set({ rhythmKey: e.target.value })}
                      className={`${inputCls} w-full`}
                      data-testid={`wizard-rhythm-${id}`}
                    >
                      {RHYTHM_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                    <span className="block text-[10px] text-slate-400">驻留 agent 的自主唤醒计划</span>
                  </label>
                </div>
                {c.rhythmKey === "custom" && (
                  <textarea
                    value={c.rhythmJson}
                    onChange={(e) => set({ rhythmJson: e.target.value })}
                    rows={2}
                    placeholder='[{"every":"30m","do":"巡检"}]'
                    className={`${inputCls} w-full`}
                    data-testid={`wizard-rhythm-json-${id}`}
                  />
                )}
              </div>
            );
          })}
          <div className="flex gap-2 items-center">
            <button onClick={() => setStep(4)} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs">下一步：计费与通知</button>
            <button onClick={() => setStep(2)} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs">上一步</button>
          </div>
        </div>
      )}

      {step === 4 && pack && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500">
            即将部署 <b>{pack.name}{version ? ` v${version}` : `（最新 v${pack.version}）`}</b> 的 {picked.size} 个 agent：
            <span className="font-mono">{[...picked].join("、")}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <label className="space-y-1">
              <span className="text-slate-500">计费键（你的 sub2api sk-…）</span>
              <input
                type="password"
                value={billingKey}
                onChange={(e) => setBillingKey(e.target.value)}
                placeholder="sk-…"
                className={`${inputCls} w-full`}
                data-testid="wizard-billing-key"
              />
              <span className="block text-[10px] text-slate-400">
                在 <a href="https://token.finddatatech.cloud" target="_blank" rel="noreferrer" className="underline">计费面板</a> 用寻数账号登录后创建；部署的回合按分钟实扣此键。
              </span>
            </label>
            <label className="space-y-1">
              <span className="text-slate-500">通知通道（可空）</span>
              <input
                value={notifyChannel}
                onChange={(e) => setNotifyChannel(e.target.value)}
                placeholder="如 fd-ops"
                className={`${inputCls} w-full`}
                data-testid="wizard-notify"
              />
              <span className="block text-[10px] text-slate-400">agent 的报告经此通道送达（运维配置的通道名）</span>
            </label>
          </div>
          {picked.size > 1 && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              勾选了多个 agent：平台要求一个计费键只绑一个 agent——若被拒收，请在面板为每个 agent 各建一键后分批部署。
            </div>
          )}
          {err && <div className="text-xs text-amber-600 dark:text-amber-400" data-testid="wizard-error">{err}</div>}
          <div className="mb-3">
          <label className="block text-xs font-medium text-slate-500 mb-1">部署目标</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            data-testid="deploy-target"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          >
            <option value="">云端运行位（自动选址）</option>
            {(seats ?? []).map((d) => (
              <option key={d.runnerId} value={d.runnerId}>
                桌面机位：{d.name || d.runnerId}（{d.runnerId}）
              </option>
            ))}
          </select>
          {target ? (
            <p className="text-[11px] text-slate-400 mt-1">
              桌面目标：agents 在该机位本地运行与计费；对外 A2A 服务待信箱协议（后续切片）开放。
            </p>
          ) : null}
        </div>
        <div className="flex gap-2 items-center">
            <button
              disabled={busy || !billingKey}
              onClick={submit}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs disabled:opacity-40"
              data-testid="wizard-submit"
            >
              {busy ? "部署中…" : "部署为服务"}
            </button>
            <button disabled={busy} onClick={() => setStep(3)} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs disabled:opacity-40">上一步</button>
          </div>
        </div>
      )}

      {step <= 2 && err && <div className="text-xs text-amber-600 dark:text-amber-400" data-testid="wizard-error">{err}</div>}
    </div>
  );
}
