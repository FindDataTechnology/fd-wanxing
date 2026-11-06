// One outbound fetch with a hard timeout (wanxing-contract-hardening 1.1):
// borrowed services (registry / packs / sub2api) previously had NO bound — a
// hung upstream stalled the turn path or admission indefinitely. The timeout
// aborts the request; the caller maps the abort to its existing structured
// error channels. Env-tunable per call site, defaults per design (8s registry
// / 5s packs / 8s sub2api).
export function fetchWithTimeout(url, { timeoutMs, fetchImpl = null, ...init } = {}) {
  const ms = Number(timeoutMs ?? 8000);
  const signal = init.signal
    ? init.signal // caller-provided signal composes (we keep theirs)
    : AbortSignal.timeout(ms);
  const doFetch = fetchImpl ?? fetch;
  return doFetch(url, { ...init, signal });
}

// Per-dependency timeout from env with a default (ms).
export function timeoutFromEnv(env, name, def) {
  const raw = env?.[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

export const OUTBOUND_TIMEOUT_DEFAULTS = {
  registry: 8000, // WANXING_REGISTRY_TIMEOUT_MS — turn forwarding runs wide
  packs: 5000,    // WANXING_PACKS_TIMEOUT_MS — snapshot fresh/stale already backstops
  sub2api: 8000,  // WANXING_SUB2API_TIMEOUT_MS — synchronous admission path
};
