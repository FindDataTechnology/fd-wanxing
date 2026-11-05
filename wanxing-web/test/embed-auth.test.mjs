// Embed credential ladder (embed-auth.js): per-slug credential store, JWT exp
// parsing, and the bearer ladder host→stored→anon. Network stubbed on fetch.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installBrowserGlobals, resetStorages } from "./helpers.mjs";

installBrowserGlobals();

const { credGet, credSet, credClear, anonGet, anonSet, anonClear, tokenExp, EmbedAuthError, resolveBearer } = await import("../src/embed-auth.js");

const jwt = (expSec) => `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url")}.s`;
const inHour = () => Math.floor(Date.now() / 1000) + 3600;

beforeEach(() => resetStorages());

test("cred store: per-slug isolation, round-trip, clear", () => {
  credSet("a", { idToken: "t-a", refreshToken: "r-a", email: "a@b.c" });
  credSet("b", { idToken: "t-b" });
  assert.equal(credGet("a").idToken, "t-a");
  assert.equal(credGet("a").email, "a@b.c");
  assert.equal(credGet("b").refreshToken, null, "missing refreshToken normalizes to null");
  assert.equal(credGet("nope"), null);
  credClear("a");
  assert.equal(credGet("a"), null);
  assert.equal(credGet("b").idToken, "t-b", "sibling slug untouched");
});

test("anon store: round-trip and per-slug clear", () => {
  anonSet("a", { token: "anon-1", expiresAt: Date.now() + 1000 });
  assert.equal(anonGet("a").token, "anon-1");
  anonClear("a");
  assert.equal(anonGet("a"), null);
});

test("tokenExp: parses exp; junk/garbage → 0 (treated as expired)", () => {
  const future = Math.floor(Date.now() / 1000) + 600;
  assert.equal(tokenExp(jwt(future)), future * 1000);
  assert.equal(tokenExp("not-a-jwt"), 0);
  assert.equal(tokenExp(""), 0);
  assert.equal(tokenExp(null), 0);
});

test("EmbedAuthError carries code/status/body with a readable message", () => {
  const e = new EmbedAuthError("ANON_DISABLED", 403, { error: { code: "ANON_DISABLED", message: "匿名未开放" } });
  assert.equal(e.code, "ANON_DISABLED");
  assert.equal(e.status, 403);
  assert.equal(e.message, "匿名未开放");
  const e2 = new EmbedAuthError("HTTP 500", 500, null);
  assert.equal(e2.message, "HTTP 500");
});

test("resolveBearer: host token wins and is never persisted", async () => {
  const out = await resolveBearer("a", { hostToken: "host-tok" });
  assert.deepEqual(out, { bearer: "host-tok", tier: "tenant", source: "host" });
  assert.equal(credGet("a"), null);
});

test("resolveBearer: stored tenant credential used while fresh", async () => {
  credSet("a", { idToken: jwt(inHour()), refreshToken: "r", email: "a@b.c" });
  const out = await resolveBearer("a", {});
  assert.deepEqual(out, { bearer: jwt(inHour()), tier: "tenant", source: "stored", email: "a@b.c" });
});

test("resolveBearer: dead stored pair is cleared and falls through (no anon allowed → null bearer)", async () => {
  credSet("a", { idToken: "garbage", refreshToken: "r", email: "" });
  globalThis.fetch = async () => { throw new Error("refresh should not be needed for unreadable token"); };
  const out = await resolveBearer("a", { anonAllowed: false });
  assert.equal(out.bearer, null);
  assert.equal(credGet("a"), null, "dead pair cleared");
});

test("resolveBearer: near-expiry stored pair silently refreshes and returns the new token", async () => {
  const soon = jwt(Math.floor(Date.now() / 1000) + 30); // < 60s → refresh path
  credSet("a", { idToken: soon, refreshToken: "r-old", email: "a@b.c" });
  const fresh = jwt(inHour());
  globalThis.fetch = async (_url, opts) => {
    assert.equal(JSON.parse(opts.body).refresh_token, "r-old");
    return { ok: true, json: async () => ({ id_token: fresh, refresh_token: "r-new" }) };
  };
  const out = await resolveBearer("a", {});
  assert.equal(out.source, "stored");
  assert.equal(out.bearer, fresh);
  assert.equal(credGet("a").refreshToken, "r-new");
});

test("resolveBearer: anon ladder mints when absent/expired, reuses when fresh", async () => {
  let mints = 0;
  globalThis.fetch = async (_url, opts) => {
    mints += 1;
    assert.equal(JSON.parse(opts.body).origin, "https://host.example");
    return { status: 201, json: async () => ({ token: `anon-${mints}`, expiresAt: Date.now() + 600_000 }) };
  };
  const first = await resolveBearer("a", { anonAllowed: true, origin: "https://host.example" });
  assert.deepEqual(first, { bearer: "anon-1", tier: "anon", source: "anon" });
  const second = await resolveBearer("a", { anonAllowed: true, origin: "https://host.example" });
  assert.equal(second.bearer, "anon-1", "fresh anon token reused");
  assert.equal(mints, 1);
});
