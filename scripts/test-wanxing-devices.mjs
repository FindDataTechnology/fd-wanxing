#!/usr/bin/env node
// ── Device pairing face tests (add-desktop-fleet-runner ③ second cut) ───────
//
// The pairing protocol against the real facade store (tmp sqlite) and a stub
// observer: code mint/list gate, redeem's single-use + shape validation +
// token rotation, the ingest forward's per-seat auth + observer relay, and
// revocation failing the very next ingest closed.
//
//   node --test scripts/test-wanxing-devices.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { test } from "node:test";
import { createHash } from "node:crypto";

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createDeviceFace } = await import("../services/wanxing-facade/devices.js");

const tmp = mkdtempSync(path.join(tmpdir(), "wx-devices-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");

// A stub observer that records relayed ingest batches behind the SERVICE
// credential the forward must swap in.
const relayed = [];
const observerApp = express();
observerApp.use(express.json({ limit: "8mb" }));
observerApp.post("/ingest", (req, res) => {
  if (req.headers.authorization !== "Bearer svc-cred") return res.status(401).json({ error: "svc" });
  relayed.push(req.body?.events ?? []);
  res.status(202).json({ ok: true });
});
const observerServer = observerApp.listen(0, "127.0.0.1");
await new Promise((r) => observerServer.once("listening", r));
const OBS = `http://127.0.0.1:${observerServer.address().port}`;
test.after(() => observerServer.close());

const store = createWanxingStore({ file: path.join(tmp, "wanxing.db") });
test.after(() => store.close());

const IDENTITY = { email: "owner@example.test", groups: [] };
const app = express();
const face = createDeviceFace({
  store,
  gate: async (req, res) => {
    if (req.headers["x-test-identity"] === "owner") {
      req.consoleIdentity = IDENTITY;
      return true;
    }
    res.status(401).json({ error: "no identity" });
    return false;
  },
  // Mirrors routes.js's observerPost: the forward swaps the seat token for
  // the SERVICE credential toward the observer.
  observerCall: async (p, init = {}) =>
    fetch(`${OBS}${p}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: "Bearer svc-cred" } }),
  publicBase: () => "https://wanxing.example.test",
});
face.register(app);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

let liveCode = "";
let liveToken = "";

test("mint requires a console identity", async () => {
  const r = await fetch(`${BASE}/api/wanxing/v1/console/devices/code`, { method: "POST" });
  assert.equal(r.status, 401);
});

test("redeem: valid code binds the seat and hands out a per-seat token once", async () => {
  const m = await fetch(`${BASE}/api/wanxing/v1/console/devices/code`, {
    method: "POST",
    headers: { "x-test-identity": "owner" },
  });
  assert.equal(m.status, 201);
  const { code, expiresInSec } = await m.json();
  liveCode = code;
  assert.match(code, /^\d{6}$/);
  assert.ok(expiresInSec > 0);

  const r = await fetch(`${BASE}/api/wanxing/v1/console/devices/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, runnerId: "desktop-ab12cd34", machineName: "书房 Mac" }),
  });
  assert.equal(r.status, 201);
  const doc = await r.json();
  liveToken = doc.fleetToken;
  assert.equal(doc.runnerId, "desktop-ab12cd34");
  assert.match(doc.fleetToken, /^wxdesk-[0-9a-f]{36}$/);
  assert.equal(doc.fleetUrl, "https://wanxing.example.test/api/wanxing/v1/fleet");

  // Single use: the same code never redeems twice.
  const again = await fetch(`${BASE}/api/wanxing/v1/console/devices/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, runnerId: "desktop-ef567890" }),
  });
  assert.equal(again.status, 401);
});

test("redeem refuses non-desktop runner ids", async () => {
  const m = await fetch(`${BASE}/api/wanxing/v1/console/devices/code`, {
    method: "POST", headers: { "x-test-identity": "owner" },
  });
  const { code } = await m.json();
  const r = await fetch(`${BASE}/api/wanxing/v1/console/devices/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, runnerId: "runner-1" }),
  });
  assert.equal(r.status, 400);
});

test("list shows the identity's seat; the board join degrades open", async () => {
  const r = await fetch(`${BASE}/api/wanxing/v1/console/devices`, { headers: { "x-test-identity": "owner" } });
  assert.equal(r.status, 200);
  const { devices } = await r.json();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].runnerId, "desktop-ab12cd34");
  assert.equal(devices[0].name, "书房 Mac");
  assert.equal(devices[0].board, null); // stub observer has no /board route
});

test("ingest forward: per-seat token relays to the observer with the service credential", async () => {
  const r = await fetch(`${BASE}/api/wanxing/v1/fleet/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${liveToken}` },
    body: JSON.stringify({ events: [{ id: "e1", source: "runner:desktop-ab12cd34", agent: "desktop-ab12cd34", runner: "desktop-ab12cd34", kind: "runner_stats", ts: 1, payload: { desktop: true } }] }),
  });
  assert.equal(r.status, 202);
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0][0].runner, "desktop-ab12cd34");

  const bad = await fetch(`${BASE}/api/wanxing/v1/fleet/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer wxdesk-not-a-real-token" },
    body: JSON.stringify({ events: [] }),
  });
  assert.equal(bad.status, 401);
});

test("revocation kills the token on the very next ingest", async () => {
  const d = await fetch(`${BASE}/api/wanxing/v1/console/devices/desktop-ab12cd34`, {
    method: "DELETE", headers: { "x-test-identity": "owner" },
  });
  assert.equal(d.status, 200);

  const r = await fetch(`${BASE}/api/wanxing/v1/fleet/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${liveToken}` },
    body: JSON.stringify({ events: [{ id: "e2", source: "x", agent: "y", kind: "runner_stats", ts: 2, payload: {} }] }),
  });
  assert.equal(r.status, 401, "revoked seat token fails closed immediately");
});
