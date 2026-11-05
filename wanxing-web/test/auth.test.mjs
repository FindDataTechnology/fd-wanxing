// Console auth store (auth.js) — logic-layer contract: storage-backed state,
// subscription store, ops channel, renewal scheduling, 401 refresh-and-retry,
// teardown. Network calls are stubbed on globalThis.fetch.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installBrowserGlobals, resetStorages } from "./helpers.mjs";

installBrowserGlobals();

const { authState, subscribeAuth, setOpsToken, renewSession, teardownSession, scheduleRenewal, authFetch, EMBED_AUTH_MESSAGE } = await import("../src/auth.js");

// b64url helper to mint JWT-shaped tokens for renewal tests.
const jwtWithExp = (expSec) => {
  const body = Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url");
  return `h.${body}.s`;
};

beforeEach(() => resetStorages());

test("authState reads credentials from storage; empty store is all-empty", () => {
  assert.deepEqual(authState(), { token: "", refresh: "", email: "", notice: "" });
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
  assert.deepEqual(authState(), { token: "", refresh: "", email: "", notice: "登录已过期，请重新登录" });
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
