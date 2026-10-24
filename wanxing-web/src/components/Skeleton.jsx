// Loading skeletons (polish-wanxing-console D5): replace the bare 加载中 text
// so a loading panel shows shape, not a label. aria-hidden — the surrounding
// region keeps its own accessible state; the skeleton is pure decoration.
export function SkeletonLines({ rows = 3, className = "" }) {
  return (
    <div className={`space-y-2 animate-pulse ${className}`} aria-hidden="true" data-testid="skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={`h-3.5 rounded bg-slate-200 dark:bg-slate-800 ${i === rows - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

export function SkeletonCards({ cards = 2, className = "" }) {
  return (
    <div className={`grid gap-3 sm:grid-cols-2 animate-pulse ${className}`} aria-hidden="true" data-testid="skeleton">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
          <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }, (_, j) => (
              <div key={j} className="space-y-1">
                <div className="h-2.5 w-14 rounded bg-slate-100 dark:bg-slate-900" />
                <div className="h-4 w-10 rounded bg-slate-200 dark:bg-slate-800" />
              </div>
            ))}
          </div>
          <div className="h-6 w-40 rounded bg-slate-200 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}
