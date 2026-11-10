// ── Desktop seat pairing (add-desktop-fleet-runner ③ second cut) ────────────
//
// The device-management protocol face: a console identity mints a short-lived
// six-digit code, the desktop app redeems it (no console session — the code is
// the proof) to bind its seat id and receive a per-seat fleet token, and the
// seat's runner reports through the facade's PUBLIC ingest forward (the
// facade verifies the seat token and relays to the observer with the service
// credential). Revocation deletes the row — the very next ingest 401s.
//
// Trust shape: the service-to-service x-facet-token never leaves the cloud;
// the desktop only ever holds its own per-seat token. An unpaired seat stays
// board-invisible exactly as before (slice ①'s zero-configuration default).

import { randomBytes, createHash } from "node:crypto";
import express from "express";

const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_FAILS = 5;
const RUNNER_ID_RE = /^desktop-[A-Za-z0-9._-]{1,60}$/;

const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");

export function createDeviceFace({
  store, // wanxing store (devices table accessors added alongside)
  gate, // async (req, res) => boolean — console identity or service token
  observerCall, // async (path, init) => Response — carries the service credential
  publicBase, // () => string — this facade's public origin (no trailing slash)
  now = Date.now,
  log = null,
}) {
  const say = log ?? (() => {});
  // Minted codes: code → { email, expiresAt, fails, used }. In-memory on
  // purpose — a restart drops live codes, and a code's whole life is ten
  // minutes; persistence would only widen the window.
  const codes = new Map();

  const mintCode = (email) => {
    // Sweep expired entries first so the pool stays tiny.
    for (const [c, v] of codes) if (v.expiresAt < now()) codes.delete(c);
    const code = String(100_000 + (randomBytes(4).readUInt32BE(0) % 900_000));
    codes.set(code, { email, expiresAt: now() + CODE_TTL_MS, fails: 0, used: false });
    return code;
  };

  const seatToken = () => `wxdesk-${randomBytes(18).toString("hex")}`;

  function register(app) {
    // Mint: a console identity gets one code valid for ten minutes, single
    // use. The desktop redeems it against the redeemer's own identity.
    app.post("/api/wanxing/v1/console/devices/code", express.json({ limit: "1kb" }), async (req, res) => {
      if (!(await gate(req, res))) return;
      const email = String(req.consoleIdentity?.email || "").toLowerCase();
      if (!email) return res.status(401).json({ error: "verified identity required" });
      const code = mintCode(email);
      say(`device pairing code minted for ${email}`);
      res.status(201).json({ code, expiresInSec: Math.floor(CODE_TTL_MS / 1000) });
    });

    // List: the identity's own seats, joined with live board presence.
    app.get("/api/wanxing/v1/console/devices", async (req, res) => {
      if (!(await gate(req, res))) return;
      const email = String(req.consoleIdentity?.email || "").toLowerCase();
      let board = null;
      try {
        const r = await observerCall("/api/fleet/v1/board");
        if (r.ok) board = await r.json();
      } catch { /* board down lists devices without presence */ }
      const rows = store.deviceListByEmail(email);
      res.json({
        devices: rows.map((d) => {
          const b = board?.runners?.[d.runner_id] ?? null;
          // Liveness beside the snapshot (add-agent-led-multi-host-lease 2.x):
          // `board` answers "what did it last say" and disappears once the
          // runner leaves the 30-minute window — which is exactly when the seat
          // looks the same as one that was never paired. `liveness` answers "when
          // did we last hear from it" and survives that window, so the client can
          // tell 迟报/失联 from 从未上线 instead of inferring both from a missing key.
          const lv = board?.runner_liveness?.[d.runner_id] ?? null;
          return {
            runnerId: d.runner_id,
            name: d.name,
            createdAt: d.created_at,
            board: b ? { seen_at: b.seen_at, agents: b.agents ?? null, desktop: b.desktop ?? null } : null,
            liveness: lv ? { presence: lv.presence, age_ms: lv.age_ms, last_seen_at: lv.last_seen_at, beats: lv.beats } : null,
          };
        }),
      });
    });

    // Redeem: the desktop's only unauthenticated surface — the six-digit code
    // is the entire proof, single-use, five failures burn it. Bind the seat,
    // rotate its token (an old token dies with the row update).
    app.post("/api/wanxing/v1/console/devices/redeem", express.json({ limit: "4kb" }), async (req, res) => {
      const { code, runnerId, machineName } = req.body ?? {};
      const entry = codes.get(String(code || ""));
      if (!entry || entry.used || entry.expiresAt < now()) {
        return res.status(401).json({ error: "invalid or expired pairing code" });
      }
      if (!RUNNER_ID_RE.test(String(runnerId || ""))) {
        return res.status(400).json({ error: "runnerId must be a desktop- seat id" });
      }
      if (entry.fails >= CODE_MAX_FAILS) {
        codes.delete(String(code));
        return res.status(401).json({ error: "pairing code burned" });
      }
      // Consume AFTER validation: a bad payload must not burn a good code,
      // but a successful redeem is strictly single-use.
      entry.used = true;
      const token = seatToken();
      const fleetUrl = `${publicBase()}/api/wanxing/v1/fleet`;
      store.deviceUpsert({
        runnerId: String(runnerId),
        ownerEmail: entry.email,
        name: String(machineName || "").slice(0, 80) || null,
        tokenHash: sha256(token),
        now: now(),
      });
      say(`seat ${runnerId} paired to ${entry.email}`);
      res.status(201).json({ runnerId: String(runnerId), fleetUrl, fleetToken: token });
    });

    // The seat's uplink: per-seat token in, service credential out to the
    // observer. A deleted (revoked) row fails the lookup — revocation takes
    // effect on the very next ingest.
    app.post("/api/wanxing/v1/fleet/ingest", express.json({ limit: "8mb" }), async (req, res) => {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token.startsWith("wxdesk-") || !store.deviceByTokenHash(sha256(token))) {
        return res.status(401).json({ error: "seat credential required" });
      }
      try {
        const r = await observerCall("/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(req.body ?? {}),
        });
        res.status(r.status);
        const text = await r.text();
        if (text) res.send(text);
        else res.end();
      } catch (e) {
        res.status(502).json({ error: `observer relay failed: ${e?.message || e}` });
      }
    });

    // Revoke: the owner deletes the seat — its token dies instantly (the
    // ingest row lookup fails) and its registry entries stay put (sticky, the
    // scheduler never re-points desktop seats — slice ③ first cut).
    app.delete("/api/wanxing/v1/console/devices/:runnerId", async (req, res) => {
      if (!(await gate(req, res))) return;
      const email = String(req.consoleIdentity?.email || "").toLowerCase();
      const ok = store.deviceDelete(String(req.params.runnerId || ""), email);
      if (!ok) return res.status(404).json({ error: "no such device for this identity" });
      say(`seat ${req.params.runnerId} revoked`);
      res.json({ ok: true });
    });
  }

  return { register };
}
