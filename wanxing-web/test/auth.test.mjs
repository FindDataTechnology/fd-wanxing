// Console auth store (auth.js) — logic-layer contract: storage-backed state,
// subscription store, ops channel, renewal scheduling, 401 refresh-and-retry,
// teardown. Network calls are stubbed on globalThis.fetch.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installBrowserGlobals, resetStorages } from "./helpers.mjs";

installBrowserGlobals();

const { authState, subscribeAuth, setOpsToken, renewSession, teardownSession, scheduleRenewal, authFetch, EMBED_AUTH_MESSAGE, armRenewalOnBoot } = await import("../src/auth.js");

// b64url helper to mint JWT-shaped tokens for renewal tests.
const jwtWithExp = (expSec) => {
  const body = Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url");
  return `h.${body}.s`;
};

beforeEach(() => resetStorages());

test("authState reads credentials from storage; empty store is all-empty", () => {
  assert.deepEqual(authState(), { token: "", refresh: "", email: "", signedIn: false, tokenExpired: false, notice: "" });
  localStorage.setItem("wanxing-console-token", "t1");
  localStorage.setItem("wanxing-console-email", "a@b.c");
  const s = authState();
  assert.equal(s.token, "t1");
  assert.equal(s.email, "a@b.c");
  assert.equal(s.refresh, "");
});

test("subscribeAuth: listeners fire on emit paths (setOpsToken) and unsubscribe stops them", () => {
  let seen = 0;
  const off = subscribeAuth(() => { seen += 1; });
  setOpsToken("ops-1");
  assert.equal(seen, 1);
  assert.equal(authState().token, "ops-1");
  // Ops channel: no refresh grant, no email — both cleared.
  localStorage.setItem("wanxing-console-refresh", "r");
  localStorage.setItem("wanxing-console-email", "x@y.z");
  setOpsToken("ops-2");
  assert.equal(authState().refresh, "");
  assert.equal(authState().email, "");
  off();
  setOpsToken("ops-3");
  assert.equal(seen, 2, "unsubscribed listener must not fire (count frozen at pre-unsub total)");
});

test("renewSession: no refresh token → resolves false without network", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("should not fetch"); };
  assert.equal(await renewSession(), false);
  assert.equal(fetchCalls, 0);
});

test("renewSession: rotation success persists the rotated pair and returns true", async () => {
  localStorage.setItem("wanxing-console-token", jwtWithExp(Math.floor(Date.now() / 1000) + 3600));
  localStorage.setItem("wanxing-console-refresh", "r-old");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ id_token: jwtWithExp(Math.floor(Date.now() / 1000) + 7200), refresh_token: "r-new" }),
  });
  assert.equal(await renewSession(), true);
  assert.equal(localStorage.getItem("wanxing-console-refresh"), "r-new");
  assert.notEqual(authState().token, "");
});

test("renewSession: failed grant returns false (caller decides teardown)", async () => {
  localStorage.setItem("wanxing-console-token", "t");
  localStorage.setItem("wanxing-console-refresh", "r");
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await renewSession(), false);
  // Renewal failure alone must not clear storage — teardown is the caller's move.
  assert.equal(localStorage.getItem("wanxing-console-token"), "t");
});

test("teardownSession: clears credentials, best-effort revoke, expired notice", async () => {
  localStorage.setItem("wanxing-console-token", "t");
  localStorage.setItem("wanxing-console-refresh", "r");
  localStorage.setItem("wanxing-console-email", "a@b.c");
  let revokeBody = null;
  globalThis.fetch = async (_url, opts) => { revokeBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) }; };
  await teardownSession({ expired: true });
  assert.deepEqual(authState(), { token: "", refresh: "", email: "", signedIn: false, tokenExpired: false, notice: "登录已过期，请重新登录" });
  assert.equal(revokeBody.token, "r");
  // Best-effort: a throwing revoke still tears down.
  localStorage.setItem("wanxing-console-token", "t2");
  globalThis.fetch = async () => { throw new Error("down"); };
  await teardownSession();
  assert.equal(authState().token, "");
  assert.equal(authState().notice, "");
});

test("scheduleRenewal: no token or no refresh grant schedules nothing (no crash)", () => {
  scheduleRenewal(); // empty store — must be a no-op, not a throw
  localStorage.setItem("wanxing-console-token", "not-a-jwt");
  scheduleRenewal(); // unreadable token — catch-and-return path
  localStorage.setItem("wanxing-console-token", jwtWithExp(Math.floor(Date.now() / 1000) + 3600));
  scheduleRenewal(); // valid — arms the timer (fired ~55min out; never awaited)
});

test("authFetch: attaches bearer; on 401 with a refresh grant retries once after renewal", async () => {
  localStorage.setItem("wanxing-console-token", "expired");
  localStorage.setItem("wanxing-console-refresh", "r");
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push([url, opts.headers?.Authorization]);
    if (url.endsWith("/auth/refresh")) {
      return { ok: true, json: async () => ({ id_token: "fresh", refresh_token: "r2" }) };
    }
    return { status: calls.length <= 1 ? 401 : 200, json: async () => ({}) };
  };
  const r = await authFetch("/api/wanxing/v1/console/my/packs");
  assert.equal(r.status, 200);
  assert.equal(calls.length, 3, "initial 401 + refresh + retried call");
  assert.equal(calls[0][1], "Bearer expired");
  assert.equal(calls[2][1], "Bearer fresh");
});

test("authFetch: 401 without a refresh grant passes through untouched (ops channel)", async () => {
  localStorage.setItem("wanxing-console-token", "ops-token");
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return { status: 401, json: async () => ({}) }; };
  const r = await authFetch("/api/wanxing/v1/console/my/packs");
  assert.equal(r.status, 401);
  assert.equal(calls.length, 1, "no refresh attempt for a grant-less token");
  assert.equal(localStorage.getItem("wanxing-console-token"), "ops-token");
});

test("embed handshake vocabulary stays stable (postMessage contract)", () => {
  assert.equal(EMBED_AUTH_MESSAGE, "wx-embed-auth");
});

// ── Boot arming (2026-11-16) ────────────────────────────────────────────────
//
// The regression this pins: scheduleRenewal() was reachable only through
// emit(), so a tab opened against an existing session armed NOTHING and the
// id_token expired in silence — the user had to sign out and back in, and read
// it as "every upgrade needs a re-login".

// The load-time side effect itself (not just the exported function): seed an
// expired session, import the module FRESH in a child process, and assert it
// refreshed without anyone calling anything. This is the half the mutation
// check found untested — deleting `void armRenewalOnBoot()` left a green suite.
test("module load arms renewal by itself (the path that was missing)", async () => {
  const { execFileSync } = await import("node:child_process");
  const script = `
    globalThis.__wxTestGlobals = true;
    const m = new Map();
    const st = { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k,v) => m.set(k,String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length(){return m.size} };
    globalThis.localStorage = st;
    globalThis.sessionStorage = { ...st, getItem: () => null, setItem: () => {}, removeItem: () => {} };
    globalThis.window = globalThis;
    globalThis.location = { origin: "https://t.local", href: "https://t.local/", search: "" };
    globalThis.addEventListener = () => {};
    const jwt = (e) => "h." + Buffer.from(JSON.stringify({exp:e})).toString("base64url") + ".s";
    st.setItem("wanxing-console-token", jwt(Math.floor(Date.now()/1000) - 60));
    st.setItem("wanxing-console-refresh", "r0");
    let refreshed = 0;
    globalThis.fetch = async (u) => {
      if (String(u).endsWith("/auth/refresh")) { refreshed++; return { ok: true, json: async () => ({ id_token: jwt(Math.floor(Date.now()/1000)+3600), refresh_token: "r1" }) }; }
      return { ok: true, json: async () => ({}) };
    };
    await import(${JSON.stringify(new URL("../src/auth.js", import.meta.url).href)});
    await new Promise(r => setTimeout(r, 30));
    process.stdout.write(String(refreshed) + ":" + (st.getItem("wanxing-console-refresh") || ""));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(out, "1:r1", "import alone must renew an expired session and persist the rotated pair");
});

test("boot arming: an already-expired token renews immediately, not eventually", async () => {
  localStorage.setItem("wanxing-console-token", jwtWithExp(Math.floor(Date.now() / 1000) - 60));
  localStorage.setItem("wanxing-console-refresh", "r");
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith("/auth/refresh")) return { ok: true, json: async () => ({ id_token: jwtWithExp(Math.floor(Date.now() / 1000) + 3600), refresh_token: "r2" }) };
    return { status: 200, json: async () => ({}) };
  };
  await armRenewalOnBoot();
  assert.equal(calls.length, 1, "one refresh grant, fired at once");
  assert.ok(calls[0].endsWith("/auth/refresh"));
  assert.equal(localStorage.getItem("wanxing-console-refresh"), "r2", "rotated pair persisted");
});

test("boot arming: a still-valid token arms the timer and makes no call", async () => {
  localStorage.setItem("wanxing-console-token", jwtWithExp(Math.floor(Date.now() / 1000) + 3600));
  localStorage.setItem("wanxing-console-refresh", "r");
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return { status: 200, json: async () => ({}) }; };
  await armRenewalOnBoot();
  assert.deepEqual(calls, [], "nothing to renew yet");
});

test("boot arming: no refresh grant (ops service token) is left alone", async () => {
  localStorage.setItem("wanxing-console-token", jwtWithExp(Math.floor(Date.now() / 1000) - 60));
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return { status: 200, json: async () => ({}) }; };
  await armRenewalOnBoot();
  assert.deepEqual(calls, [], "an unrefreshable token is not ours to renew");
});

test("boot arming: a failed refresh does not tear the session down", async () => {
  localStorage.setItem("wanxing-console-token", jwtWithExp(Math.floor(Date.now() / 1000) - 60));
  localStorage.setItem("wanxing-console-refresh", "r");
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: "facade restarting" }) });
  await armRenewalOnBoot();
  assert.equal(localStorage.getItem("wanxing-console-token") !== null, true, "session survives a transient failure");
  assert.equal(authState().notice, "", "and is not marked expired");
});

// ── signedIn: the header's truth (2026-11-16) ───────────────────────────────
//
// The header rendered 邮箱·退出 off `Boolean(token)` alone, so a session whose
// id_token had been dead for 32 days still looked signed in. That is the
// visible half of the same bug the boot arming fixes.

test("signedIn: a live id_token reads as signed in", () => {
  localStorage.setItem("wanxing-console-token", jwtWithExp(Math.floor(Date.now() / 1000) + 3600));
  localStorage.setItem("wanxing-console-email", "a@b.c");
  const s = authState();
  assert.equal(s.signedIn, true);
  assert.equal(s.tokenExpired, false);
});

test("signedIn: an expired id_token does NOT read as signed in, but the grant survives", () => {
  localStorage.setItem("wanxing-console-token", jwtWithExp(Math.floor(Date.now() / 1000) - 60));
  localStorage.setItem("wanxing-console-refresh", "r");
  localStorage.setItem("wanxing-console-email", "a@b.c");
  const s = authState();
  assert.equal(s.signedIn, false, "the header must not claim an identity it cannot use");
  assert.equal(s.tokenExpired, true);
  assert.equal(s.refresh, "r", "the refresh grant stays stored — renewal needs it");
});

test("signedIn: an opaque ops token has no exp and reads as signed in", () => {
  localStorage.setItem("wanxing-console-token", "ops-service-token");
  const s = authState();
  assert.equal(s.signedIn, true, "a token with no exp never expires by design");
  assert.equal(s.tokenExpired, false);
});
