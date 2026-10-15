#!/usr/bin/env node
// ── Seat mailbox tests (add-desktop-fleet-runner ④) ────────────────────────
//
// The mailbox protocol against the real facade store (tmp sqlite): deposit
// (console gate), per-seat pull marks delivered, settle records the outcome,
// retrieve reads it back — and revocation kills pull/result with the seat's
// token.
//
//   node --test scripts/test-wanxing-mailbox.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { test } from "node:test";
import { createHash } from "node:crypto";

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createMailboxFace, newTaskId } = await import("../services/wanxing-facade/mailbox.js");

const tmp = mkdtempSync(path.join(tmpdir(), "wx-mailbox-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");

const store = createWanxingStore({ file: path.join(tmp, "wanxing.db") });
test.after(() => store.close());

// One paired seat with a known token.
const SEAT = "desktop-mb000001";
const TOKEN = "wxdesk-known-token";
store.deviceUpsert({ runnerId: SEAT, ownerEmail: "owner@example.test", name: "t", tokenHash: sha256(TOKEN), now: 1 });

const app = express();
app.use(express.json({ limit: "256kb" }));
const face = createMailboxFace({
  store,
  gate: async (req, res) => {
    if (req.headers["x-test-identity"] === "owner") {
      req.consoleIdentity = { email: "owner@example.test", groups: [] };
      return true;
    }
    res.status(401).json({ error: "no identity" });
    return false;
  },
  seatAuth: (req) => {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token.startsWith("wxdesk-")) return null;
    const row = store.deviceByTokenHash(sha256(token));
    return row ? { runnerId: row.runner_id } : null;
  },
  log: () => {},
});
face.register(app);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

let taskId = "";

test("deposit queues a task for the seat (console gate)", async () => {
  const noAuth = await fetch(`${BASE}/api/wanxing/v1/seats/${SEAT}/mailbox`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentPath: "/packs/p1/a", text: "hi" }) });
  assert.equal(noAuth.status, 401);

  const r = await fetch(`${BASE}/api/wanxing/v1/seats/${SEAT}/mailbox`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-identity": "owner" },
    body: JSON.stringify({ agentPath: "/packs/p1/a", text: "生成今日简报" }),
  });
  assert.equal(r.status, 201);
  taskId = (await r.json()).taskId;
  assert.match(taskId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("pull (seat credential) returns the task once and marks it delivered", async () => {
  const noTok = await fetch(`${BASE}/api/wanxing/v1/fleet/mailbox`);
  assert.equal(noTok.status, 401);

  const r = await fetch(`${BASE}/api/wanxing/v1/fleet/mailbox`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 200);
  const { tasks } = await r.json();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].taskId, taskId);
  assert.equal(tasks[0].agentPath, "/packs/p1/a");
  assert.equal(tasks[0].text, "生成今日简报");

  const again = await fetch(`${BASE}/api/wanxing/v1/fleet/mailbox`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.deepEqual((await again.json()).tasks, [], "delivered tasks do not redeliver");
});

test("settle records the outcome; retrieve reads it back", async () => {
  const r = await fetch(`${BASE}/api/wanxing/v1/fleet/mailbox/result`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ id: taskId, ok: true, text: "简报：今日无大事。" }),
  });
  assert.equal(r.status, 200);

  const q = await fetch(`${BASE}/api/wanxing/v1/console/mailbox/${taskId}`, { headers: { "x-test-identity": "owner" } });
  assert.equal(q.status, 200);
  const doc = await q.json();
  assert.equal(doc.status, "done");
  assert.equal(doc.result, "简报：今日无大事。");

  // A settled task cannot be settled again (idempotent-by-state).
  const re = await fetch(`${BASE}/api/wanxing/v1/fleet/mailbox/result`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ id: taskId, ok: true, text: "dup" }),
  });
  assert.equal(re.status, 404);
});

test("revocation kills the seat's mailbox access with its telemetry access", async () => {
  store.deviceDelete(SEAT, "owner@example.test");
  const r = await fetch(`${BASE}/api/wanxing/v1/fleet/mailbox`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 401);
});

test("newTaskId is ULID-shaped and monotonic-ish unique", () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newTaskId()));
  assert.equal(ids.size, 1000);
});
