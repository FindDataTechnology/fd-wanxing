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
  // A model turn answers only when it finishes — production runs 2–5 minutes
  // per ticket, so the three control-plane bounds above are the wrong shape
  // for it. Without an entry here the long path inherited undici's 300 s
  // `headersTimeout` and every turn that ran past it was recorded as the
  // generic -32032 instead of -32041 (2026-11-14: five consecutive turns at
  // 300–301 s while the same hop answered a cheap request in 262 ms — the
  // transport was healthy and WE were the ones giving up). 15 minutes covers
  // a turn plus its tool work; WANXING_TURN_TIMEOUT_MS tunes it per deployment.
  turn: 900_000,
};
