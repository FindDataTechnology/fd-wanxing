// Console-shared presentation helpers (refactor-console-ia): extracted from
// the former monolith verbatim — one definition, three views.
export const fmtMs = (ms) => (ms == null ? "n/a" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
export const fmtAgo = (ms) => (ms == null ? "?" : ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`);

export const channelLabel = (c) => (c === "chat" ? "对话" : c === "api" ? "API" : c ?? "?");

export const sourceBadge = (dim) => {
  const s = dim?.source;
  const label = s === "override" ? "已覆盖" : s === "declared" ? "跟随声明" : "默认";
  const tone = s === "override" ? "bg-accent text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500";
  return <span className={`ml-2 px-1.5 py-0.5 rounded text-[11px] ${tone}`}>{label}</span>;
};

// Plan-request status (add-plan-requests-and-move-statement): one vocabulary
// for the caller's own list (消耗) and the ops queue (运维面).
const PLAN_REQUEST_STATUS = {
  pending: ["待审", "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"],
  approved: ["已批准", "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"],
  rejected: ["已驳回", "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"],
};
export const planRequestBadge = (status) => {
  const [label, tone] = PLAN_REQUEST_STATUS[status] ?? [status ?? "?", "bg-slate-100 dark:bg-slate-800 text-slate-500"];
  return <span className={`px-1.5 py-0.5 rounded font-mono ${tone}`} data-testid="plan-request-status" data-status={status}>{label}</span>;
};
