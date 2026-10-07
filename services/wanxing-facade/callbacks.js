// ── Turn-completion callbacks (add-caller-preferences) ─────────────────────
//
// The caller-configured webhook: when an admitted external turn completes,
// the facade signs and POSTs the outcome to the caller's own endpoint —
// best-effort with a bounded retry ladder (the caller polls nothing). This is
// notification, never settlement: it rides BESIDE the ledger and settles
// nothing (ADR-0014 untouched).
//
// Discipline:
//   • the secret signs, never rides: no request/log/audit ever carries it;
//   • the body is signed WHOLE as `t=<unix>,v1=HMAC-SHA256("<t>.<body>")` —
//     the caller verifies fresh-ness by `t` and integrity by the digest;
//   • idempotency anchors on `trace_id` (the usage-row id): a retried or
//     duplicated delivery is deduplicatable by the receiver;
//   • fire-and-forget: dispatch() returns the FIRST attempt's promise (the
//     request path `void`s it); retries ride unref'd timers so a facade
//     process never lingers for a callback.

import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// 1m / 4m / 10m after the first attempt — total window 15 minutes.
export const DEFAULT_RETRY_DELAYS_MS = [60_000, 240_000, 600_000];

export function signCallback(body, secret, at = Math.floor(Date.now() / 1000)) {
  const digest = createHmac("sha256", secret).update(`${at}.${body}`).digest("hex");
  return `t=${at},v1=${digest}`;
}

export function createCallbackDispatcher({
  store,
  fetchImpl = fetch,
  log = null,
  auditFile = null,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  now = () => Date.now(),
  timeoutMs = 10_000,
}) {
  const say = log ?? (() => {});
  if (auditFile) mkdirSync(path.dirname(auditFile), { recursive: true });

  const audit = (line) => {
    if (!auditFile) return;
    try {
      appendFileSync(auditFile, `${JSON.stringify(line)}\n`);
    } catch { /* audit must never break delivery */ }
  };

  const safeHost = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return "(unparseable)";
    }
  };

  async function attempt({ url, secret, body, traceId, slug, attemptNo }) {
    const headers = {
      "Content-Type": "application/json",
      "X-Facet-Signature": signCallback(body, secret, Math.floor(now() / 1000)),
      "X-Facet-Event": "turn.completed",
    };
    try {
      const res = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok || (res.status >= 200 && res.status < 300)) {
        audit({ at: now(), agent: slug, trace_id: traceId, host: safeHost(url), attempt: attemptNo, result: "delivered", status: res.status });
        return true;
      }
      audit({ at: now(), agent: slug, trace_id: traceId, host: safeHost(url), attempt: attemptNo, result: "rejected", status: res.status });
      return false;
    } catch (e) {
      audit({ at: now(), agent: slug, trace_id: traceId, host: safeHost(url), attempt: attemptNo, result: "unreachable", reason: String(e?.message || e).slice(0, 200) });
      return false;
    }
  }

  // Fire the completion callback for one finished turn. Returns the first
  // attempt's outcome promise (false when no preference / first attempt
  // failed); retries continue in the background on unref'd timers.
  function dispatch({ caller, slug, idemKey, outcome, startedAt, endedAt, minutesBilled, traceId }) {
    const pref = store.prefsGet(caller.userId, slug);
    if (!pref?.callbackUrl || !pref?.callbackSecret) return Promise.resolve(false);
    const payload = {
      event: "turn.completed",
      agent: slug,
      caller: { id: caller.userId },
      trace_id: traceId,
      outcome,
      idem_key: idemKey || null,
      started_at: startedAt,
      ended_at: endedAt,
      minutes_billed: minutesBilled ?? 0,
    };
    const body = JSON.stringify(payload);
    const url = pref.callbackUrl;
    const secret = pref.callbackSecret;

    const first = attempt({ url, secret, body, traceId, slug, attemptNo: 1 });
    first.then((ok) => {
      if (ok) return;
      let attemptNo = 1;
      const schedule = (i) => {
        if (i >= retryDelaysMs.length) {
          audit({ at: now(), agent: slug, trace_id: traceId, host: safeHost(url), attempt: attemptNo, result: "failed", reason: "retry window exhausted" });
          say(`callbacks: ${slug} ${traceId} delivery failed after ${attemptNo} attempts`);
          return;
        }
        const timer = setTimeout(async () => {
          attemptNo += 1;
          const ok = await attempt({ url, secret, body, traceId, slug, attemptNo });
          if (!ok) schedule(i + 1);
        }, retryDelaysMs[i]);
        timer.unref?.(); // never hold a process open for a callback
      };
      schedule(0);
    });
    return first;
  }

  return { dispatch, signCallback };
}