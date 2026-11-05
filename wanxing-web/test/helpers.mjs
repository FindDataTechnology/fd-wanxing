// Test-environment browser globals (installed before any src import):
// auth.js touches window/localStorage/sessionStorage at module top level;
// views touch navigator.clipboard/matchMedia only inside effects (skipped
// under static render) — stubbed anyway so future module-level use is safe.
// Zero dependencies; mirrors the shapes node lacks, nothing more.

const makeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
};

export function installBrowserGlobals() {
  if (globalThis.__wxTestGlobals) return;
  globalThis.__wxTestGlobals = true;
  const local = makeStorage();
  const session = makeStorage();
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;
  globalThis.window = globalThis;
  globalThis.location = globalThis.location ?? { origin: "https://test.local", href: "https://test.local/", search: "", hash: "" };
  globalThis.matchMedia = globalThis.matchMedia ?? ((q) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  // auth.js subscribes at module load; a no-op keeps cross-tab sync inert.
  globalThis.addEventListener = globalThis.addEventListener ?? (() => {});
}

// Reset the storage buckets between tests (auth state must not leak).
export function resetStorages() {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
}
