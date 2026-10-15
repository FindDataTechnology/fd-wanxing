// ── Desktop seat mailbox (add-desktop-fleet-runner ④) ───────────────────────
//
// The inbound half of desktop-seat service: an external A2A caller addresses
// a desktop-hosted agent through the Wanxing facade's normal message/send;
// the facade sees a desktop_seat entry and DEPOSITS the turn here instead of
// proxying (the seat's origin is a home NAT — unreachable by design). The
// seat's runner polls its box over the same per-seat-credentialed fleet
// prefix it already reports telemetry through, runs the turn, and posts the
// result back. Pure outbound polling from the seat: zero inbound channels,
// NAT-immune, auditable at the relay.
//
// v1 semantics: message/send answers immediately with a queued-ack naming
// the taskId; results are retrieved by task id (the console face and the
// caller's polling). message/stream is refused for seat targets (-32601) —
// streaming to a cold-resident seat behind NAT is not a thing.

import { randomBytes } from "node:crypto";
import express from "express";

const TASK_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function createMailboxFace({
  store, // wanxing store (mailbox table accessors)
  gate, // async (req, res) => boolean — console/service identity
  seatAuth, // (req) => { runnerId } | null — per-seat token check (shared with the fleet ingest forward)
  now = Date.now,
  log = null,
}) {
  const say = log ?? (() => {});

  function register(app) {
    // Deposit (internal: the A2A face calls the store directly; this route
    // exists for the console/service lane to queue a task by hand).
    app.post("/api/wanxing/v1/seats/:runnerId/mailbox", express.json({ limit: "64kb" }), async (req, res) => {
      if (!(await gate(req, res))) return;
      const runnerId = String(req.params.runnerId || "");
      const agentPath = String(req.body?.agentPath || "");
      const text = String(req.body?.text || "").trim();
      if (!runnerId || !agentPath || !text) {
        return res.status(400).json({ error: "runnerId, agentPath and text are required" });
      }
      const taskId = newTaskId();
      store.mailboxEnqueue({ id: taskId, runnerId, agentPath, text, callerEmail: String(req.consoleIdentity?.email || ""), now: now() });
      say(`mailbox task ${taskId} queued for ${runnerId}`);
      res.status(201).json({ taskId });
    });

    // Pull (per-seat): the seat's queued tasks, marked delivered atomically.
    app.get("/api/wanxing/v1/fleet/mailbox", async (req, res) => {
      const seat = seatAuth(req);
      if (!seat) return res.status(401).json({ error: "seat credential required" });
      const tasks = store.mailboxPull(seat.runnerId, now());
      res.json({ tasks });
    });

    // Result (per-seat): the turn's outcome lands in the box for retrieval.
    app.post("/api/wanxing/v1/fleet/mailbox/result", express.json({ limit: "256kb" }), async (req, res) => {
      const seat = seatAuth(req);
      if (!seat) return res.status(401).json({ error: "seat credential required" });
      const id = String(req.body?.id || "");
      const ok = req.body?.ok === true;
      const text = String(req.body?.text ?? "");
      if (!TASK_ID_RE.test(id)) return res.status(400).json({ error: "bad task id" });
      const updated = store.mailboxSettle(id, seat.runnerId, ok, text.slice(0, 200_000), now());
      if (!updated) return res.status(404).json({ error: "no such task for this seat" });
      res.json({ ok: true });
    });

    // Retrieve (console/service): status + result of a task.
    app.get("/api/wanxing/v1/console/mailbox/:id", async (req, res) => {
      if (!(await gate(req, res))) return;
      const id = String(req.params.id || "");
      if (!TASK_ID_RE.test(id)) return res.status(400).json({ error: "bad task id" });
      const task = store.mailboxGet(id);
      if (!task) return res.status(404).json({ error: "no such task" });
      res.json({
        taskId: task.id,
        runnerId: task.runner_id,
        agentPath: task.agent_path,
        status: task.status,
        text: task.text,
        result: task.ok === 1 ? task.result_text : null,
        error: task.ok === 0 ? task.result_text : null,
        createdAt: task.created_at,
        deliveredAt: task.delivered_at,
        doneAt: task.done_at,
      });
    });
  }

  return { register };
}

export function newTaskId() {
  // ULID-shaped (26 chars, Crockford base32) — matches the observer's id
  // alphabet so logs grep uniformly.
  const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let ts = Date.now();
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ENC[ts % 32] + out;
    ts = Math.floor(ts / 32);
  }
  const rnd = randomBytes(10);
  for (let i = 0; i < 16; i++) {
    const b = rnd[i >> 1];
    out += ENC[i % 2 ? b & 0x0f : b >> 4];
  }
  return out;
}
