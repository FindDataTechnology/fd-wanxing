// Console-shared presentation helpers (refactor-console-ia): extracted from
// the former monolith verbatim — one definition, three views.
export const fmtMs = (ms) => (ms == null ? "n/a" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
export const fmtAgo = (ms) => (ms == null ? "?" : ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`);

export const channelLabel = (c) => (c === "chat" ? "对话" : c === "api" ? "API" : c ?? "?");

export const sourceBadge = (dim) => {
  const s = dim?.source;
  const label = s === "override" ? "已覆盖" : s === "declared" ? "跟随声明" : "默认";
  const tone = s === "override" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800 text-slate-500";
  return <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${tone}`}>{label}</span>;
};
