// 我的任务 (refactor-console-ia, M4④ 前置): the owner's four-tuple missions —
// list, create, submit/approve/abort, and the planner-artifact detail view.
// Moved verbatim from the ConsoleView monolith.
import { useEffect, useState } from "react";
import { authFetch } from "../../auth.js";

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
        <input
          value={mDraft.goal}
          onChange={(e) => setMDraft({ ...mDraft, goal: e.target.value })}
          placeholder="目标：一句话说清要 planner 做什么"
          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
        />
        <div className="flex gap-2 items-center flex-wrap">
          <input
            value={mDraft.model}
            onChange={(e) => setMDraft({ ...mDraft, model: e.target.value })}
            placeholder="模型（可空=默认）"
            className="w-40 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          />
          <input
            value={mDraft.hours}
            onChange={(e) => setMDraft({ ...mDraft, hours: e.target.value })}
            inputMode="numeric"
            placeholder="时间窗(小时)"
            className="w-24 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
          />
          <input
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
          <button disabled={mBusy || !mDraft.goal.trim()} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs disabled:opacity-40">
            {mBusy ? "处理中…" : "创建任务"}
          </button>
        </div>
      </form>
      {missions && missions.missions.length > 0 && (
        <div className="text-xs space-y-1" data-testid="missions-list">
          {missions.missions.map((m) => (
            <div key={m.id} className="flex gap-2 items-center flex-wrap">
              <span className={`px-1.5 py-0.5 rounded font-mono ${m.status === "reported" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : m.status === "failed" || m.status === "aborted" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>{m.status}</span>
              <button onClick={() => openMission(m.id)} className="w-64 truncate text-left hover:underline">{m.goal || "—"}</button>
              <span>已用 {m.spentMinutes}/{m.costCapMinutes} 分钟 · {m.approval === "auto" ? "自动" : "人批"}</span>
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
          <div>窗口 {new Date(mDetail.doc.windowStart).toLocaleString()} ~ {new Date(mDetail.doc.windowEnd).toLocaleString()} · 已用 {mDetail.doc.spentMinutes}/{mDetail.doc.costCapMinutes} 分钟</div>
          {mDetail.doc.plan && (
            <div className="space-y-0.5">
              {mDetail.doc.plan.steps.map((st) => (
                <div key={st.id} className="flex gap-2">
                  <span className="font-mono text-slate-400">{st.id}</span>
                  <span className={`w-16 ${st.status === "done" ? "text-emerald-600" : st.status === "running" ? "text-sky-600" : "text-slate-400"}`}>{st.status}</span>
                  <span className="flex-1 truncate">{st.prompt}</span>
                </div>
              ))}
            </div>
          )}
          {mDetail.doc.report && <div className="whitespace-pre-wrap border-t border-slate-200 dark:border-slate-800 pt-1">{mDetail.doc.report.summary}</div>}
          <div className="text-slate-400">{mDetail.doc.history.map((x) => `${x.to}(${x.by})`).join(" → ")}</div>
        </div>
      )}
    </div>
  );
}
