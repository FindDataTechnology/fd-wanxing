// Transient success feedback (polish-wanxing-console D2): write operations
// confirm with an auto-dismissing toast; errors stay in place — the panel and
// card banners carry failure semantics (403 vs outage) that a disappearing
// toast would swallow. One host per console view, one slot per toast.
import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastCtx = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]); // { id, text }
  const nextId = useRef(0);
  const toast = useCallback((text) => {
    const id = ++nextId.current;
    setToasts((p) => [...p, { id, text }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] space-y-2 pointer-events-none" role="status" aria-live="polite" data-testid="toast-host">
        {toasts.map((t) => (
          <div key={t.id} className="rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs px-3 py-2 shadow-lg max-w-xs" data-testid="toast-item">
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
