// Right-side drawer (polish-wanxing-console D1): the fleet management panels
// open over the deployments list instead of stacking below the cards — one at
// a time, closable by the X button, Escape, or the overlay click.
import { useEffect, useRef } from "react";

export function Drawer({ title, onClose, children, testid }) {
  const panelRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50" data-testid={testid ?? "console-drawer"}>
      <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" onClick={onClose} aria-hidden="true" data-testid="console-drawer-overlay" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "管理面板"}
        tabIndex={-1}
        className="absolute right-0 top-0 h-full w-full max-w-xl bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-xl overflow-y-auto outline-none"
        data-testid="console-drawer-panel"
      >
        <div className="sticky top-0 flex items-center gap-3 px-4 py-3 bg-white/95 dark:bg-slate-950/95 border-b border-slate-200 dark:border-slate-800 backdrop-blur">
          <div className="min-w-0 flex-1">{title}</div>
          <button
            onClick={onClose}
            aria-label="关闭面板"
            className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-xs shrink-0"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
