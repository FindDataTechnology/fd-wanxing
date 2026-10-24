// 我的任务 (refactor-console-ia, M4④ 前置): the owner's four-tuple missions —
// list, create, submit/approve/abort, and the planner-artifact detail view.
// Moved verbatim from the ConsoleView monolith.
import { useEffect, useState } from "react";
import { authFetch } from "../../auth.js";

// Cockpit watermark (add-cockpit-views, M4④b): spent against a cap — the
// amber tone starts at 80% of the ceiling; a capped bar never lies about 100%.
const Watermark = ({ spent, cap, label, testid }) => (
  <div className="min-w-32" data-testid={testid}>
    <div className="flex justify-between text-[11px] text-slate-400">
      <span>{label}</span>
      <span>{spent}/{cap}</span>
    </div>
    <div className="h-1.5 mt-0.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
      <div
        className={`h-full ${spent >= cap ? "bg-rose-500" : cap && spent / cap >= 0.8 ? "bg-amber-500" : "bg-sky-500"}`}
        style={{ width: `${Math.min(100, cap ? (spent / cap) * 100 : 0)}%` }}
      />
    </div>
  </div>
);

export function MissionsView() {
  const [missions, setMissions] = useState(null);
  const [missionErr, setMissionErr] = useState("");
  const [mDraft, setMDraft] = useState({ goal: "", model: "", hours: "24", cap: "30", approval: "human" });
  const [mBusy, setMBusy] = useState(false);
  const [mDetail, setMDetail] = useState(null);

  const loadMissions = () =>
    authFetch("/api/wanxing/v1/console/missions")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (setMissions(d), setMissionErr("")))
      .catch((e) => setMissionErr(String(e?.message || e)));

  useEffect(() => {
    loadMissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createMission = async (e) => {
    e.preventDefault();
    setMBusy(true);
    try {
      const r = await authFetch("/api/wanxing/v1/console/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: mDraft.goal,
          model: mDraft.model,
          windowStart: Date.now(),
          windowEnd: Date.now() + Math.max(1, Number(mDraft.hours) || 24) * 3_600_000,
          costCapMinutes: Number(mDraft.cap) || 30,
          approval: mDraft.approval,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setMDraft({ ...mDraft, goal: "" });
      loadMissions();
    } catch (err) {
      setMissionErr(String(err?.message || err));
    } finally {
      setMBusy(false);
    }
  };

  const missionAction = async (id, act) => {
    setMBusy(true);
    try {
      const r = await authFetch(`/api/wanxing/v1/console/missions/${id}/${act}`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error?.message || d.error || `HTTP ${r.status}`);
      loadMissions();
      if (mDetail?.id === id) openMission(id);
    } finally {
      setMBusy(false);
    }
  };

  const openMission = async (id) => {
    const r = await authFetch(`/api/wanxing/v1/console/missions/${id}`);
    const d = await r.json().catch(() => ({}));
    if (r.ok) setMDetail({ id, doc: d.mission });
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3" data-testid="missions-panel">
      <h2 className="font-semibold">我的任务</h2>
      {missionErr && <div className="text-xs text-amber-600 dark:text-amber-400">{missionErr}</div>}
      {missions && missions.plannerConfigured === false && (
        <div className="text-xs text-amber-600 dark:text-amber-400" data-testid="missions-degraded">
          平台未配置 planner（MISSION_PLANNER_SLUG）——可建草稿，提交会被显式拒绝。
        </div>
      )}
      <form onSubmit={createMission} className="space-y-2">
        <input aria-label="任务目标"
          value={mDraft.goal}
          onChange={(e) => setMDraft({ ...mDraft, goal: e.target.value })}
          placeholder="目标：一句话说清要 planner 做什么"
          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
        />
        <div className="flex gap-2 items-center flex-wrap">
          <input aria-label="模型（可空=默认）"
            value={mDraft.model}
            onChange={(e) => setMDraft({ ...mDraft, model: e.target.value })}
            placeholder="模型（可空=默认）"
            className="w-40 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          />
          <input aria-label="时间窗（小时）"
            value={mDraft.hours}
            onChange={(e) => setMDraft({ ...mDraft, hours: e.target.value })}
            inputMode="numeric"
            placeholder="时间窗(小时)"
            className="w-24 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
          />
          <input aria-label="成本上限（分钟）"
            value={mDraft.cap}
            onChange={(e) => setMDraft({ ...mDraft, cap: e.target.value })}
            inputMode="numeric"
            placeholder="成本上限(分钟)"
            className="w-28 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
          />
          <select
            value={mDraft.approval}
            onChange={(e) => setMDraft({ ...mDraft, approval: e.target.value })}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="human">人批计划</option>
            <option value="auto">自动执行</option>
          </select>
          <button disabled={mBusy || !mDraft.goal.trim()} className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-40">
            {mBusy ? "处理中…" : "创建任务"}
          </button>
        </div>
      </form>
      {missions && (missions.missions ?? []).length > 0 && (
        <div className="text-xs space-y-1" data-testid="missions-list">
          {(missions.missions ?? []).map((m) => (
            <div key={m.id} className="flex gap-2 items-center flex-wrap">
              <span className={`px-1.5 py-0.5 rounded font-mono ${m.status === "reported" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : m.status === "failed" || m.status === "aborted" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>{m.status}</span>
              <button onClick={() => openMission(m.id)} className="w-64 truncate text-left hover:underline">{m.goal || "—"}</button>
              <Watermark spent={m.spentMinutes ?? 0} cap={m.costCapMinutes ?? 0} label="成本" testid={`mission-cost-${m.id}`} />
              <span className="text-slate-400">{m.approval === "auto" ? "自动" : "人批"}</span>
              {m.status === "draft" && <button disabled={mBusy} onClick={() => missionAction(m.id, "submit")} className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700">提交</button>}
              {m.status === "awaiting_approval" && <button disabled={mBusy} onClick={() => missionAction(m.id, "approve")} className="px-2 py-0.5 rounded border border-emerald-400 text-emerald-700 dark:text-emerald-300">批准</button>}
              {!["reported", "failed", "aborted"].includes(m.status) && <button disabled={mBusy} onClick={() => missionAction(m.id, "abort")} className="px-2 py-0.5 rounded border border-rose-300 text-rose-600 dark:text-rose-300">中止</button>}
            </div>
          ))}
        </div>
      )}
      {mDetail && mDetail.doc && (
        <div className="text-xs border-t border-slate-200 dark:border-slate-800 pt-2 space-y-1" data-testid="mission-detail">
          <div className="font-mono text-slate-400">{mDetail.id}</div>
          <div>目标：{mDetail.doc.goal}</div>
          <div>窗口 {new Date(mDetail.doc.windowStart).toLocaleString()} ~ {new Date(mDetail.doc.windowEnd).toLocaleString()} · 剩余 {Math.max(0, Math.round((mDetail.doc.windowEnd - Date.now()) / 3_600_000))} 小时</div>
          <div className="flex gap-4 pt-1" data-testid={`mission-progress-${mDetail.id}`}>
            {mDetail.doc.plan && (
              <Watermark
                spent={(mDetail.doc.plan.steps ?? []).filter((st) => st.status === "done").length}
                cap={(mDetail.doc.plan.steps ?? []).length}
                label="步骤"
                testid={`mission-steps-${mDetail.id}`}
              />
            )}
            <Watermark spent={mDetail.doc.spentMinutes ?? 0} cap={mDetail.doc.costCapMinutes ?? 0} label="成本" testid={`mission-cost-${mDetail.id}`} />
          </div>
          {mDetail.doc.plan && (
            <div className="space-y-0.5">
              {(mDetail.doc.plan.steps ?? []).map((st) => (
                <div key={st.id} className="flex gap-2">
                  <span className="font-mono text-slate-400">{st.id}</span>
                  <span className={`w-16 ${st.status === "done" ? "text-emerald-600" : st.status === "running" ? "text-sky-600" : "text-slate-400"}`}>{st.status}</span>
                  <span className="flex-1 truncate">{st.prompt}</span>
                </div>
              ))}
            </div>
          )}
          {mDetail.doc.report && <div className="whitespace-pre-wrap border-t border-slate-200 dark:border-slate-800 pt-1">{mDetail.doc.report.summary}</div>}
          <div className="text-slate-400">{(mDetail.doc.history ?? []).map((x) => `${x.to}(${x.by})`).join(" → ")}</div>
        </div>
      )}
    </div>
  );
}
