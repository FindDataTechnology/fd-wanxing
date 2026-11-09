#!/usr/bin/env node
// ── Agent health derivation (surface-silent-agent-failures 1.1–1.5) ──────────
//
// The point of this suite is the four distinctions that keep a health signal
// from turning into noise or into false comfort:
//   silent ≠ healthy ≠ failing · paused is not failure · sustained ≠ proportional
//   · unknown (failed, cause unknown) ≠ null (no failure)
//
//   node --test scripts/test-fleet-health.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

const { deriveHealth, deriveFleetHealth, hourKeyToMs, HEALTH } = await import("../services/fleet-observer/health.js");

const hours = (n, start = 1) => Array.from({ length: n }, (_, i) => `2026-11-10T${String(start + i).padStart(2, "0")}:00`);
const row = (hour, turns, errors, kills = 0) => ({ hour, agent: "a", turns, errors, budget_kills: kills });

// ── 1.1 five states ─────────────────────────────────────────────────────────

test("1.1 failing: every turn failed and the sustained volume reaches the minimum", () => {
  const h = deriveHealth({ rows: [row(hours(3)[0], 2, 2), row(hours(3)[1], 3, 3), row(hours(3)[2], 1, 1)] });
  assert.equal(h.health, HEALTH.FAILING);
  assert.equal(h.consecutive, 6);
  assert.equal(h.consecutiveHours, 3);
  assert.equal(h.since, hourKeyToMs(hours(3)[0]));
});

test("1.1 silent: zero turns is no information — not healthy, not failing", () => {
  const h = deriveHealth({ rows: [row(hours(2)[0], 0, 0), row(hours(2)[1], 0, 0)] });
  assert.equal(h.health, HEALTH.SILENT);
  assert.equal(h.since, null);
});

test("1.1 ok: a clean window", () => {
  const h = deriveHealth({ rows: [row(hours(2)[0], 4, 0), row(hours(2)[1], 3, 0)] });
  assert.equal(h.health, HEALTH.OK);
});

test("1.1 degraded: mixed outcomes above the ratio threshold", () => {
  const h = deriveHealth({ rows: [row(hours(2)[0], 2, 2), row(hours(2)[1], 2, 0)] });
  assert.equal(h.health, HEALTH.DEGRADED);
});

test("1.1 paused wins over a wall of failures", () => {
  const h = deriveHealth({ rows: [row(hours(3)[0], 5, 5), row(hours(3)[1], 5, 5), row(hours(3)[2], 5, 5)], paused: true });
  assert.equal(h.health, HEALTH.PAUSED);
});

// ── 1.2 thresholds are independent constants ────────────────────────────────

test("1.2 the sustained minimum is honoured exactly and is not a ratio", () => {
  const rows = [row(hours(2)[0], 1, 1), row(hours(2)[1], 1, 1)];
  assert.equal(deriveHealth({ rows, failingMinConsecutive: 3 }).health, HEALTH.DEGRADED); // 2 < 3 ⇒ not failing
  assert.equal(deriveHealth({ rows, failingMinConsecutive: 2 }).health, HEALTH.FAILING);
  // one failure at low volume is 100% — must not become "failing" by ratio alone
  assert.equal(deriveHealth({ rows: [row(hours(1)[0], 1, 1)], failingMinConsecutive: 3 }).health, HEALTH.DEGRADED);
});

test("1.2 the degraded ratio is its own setting", () => {
  const rows = [row(hours(2)[0], 1, 1), row(hours(2)[1], 9, 0)];
  assert.equal(deriveHealth({ rows, degradedErrorRate: 0.05 }).health, HEALTH.DEGRADED);
  assert.equal(deriveHealth({ rows, degradedErrorRate: 0.5 }).health, HEALTH.OK);
});

// ── 1.3 pause / unreadable pause flag ───────────────────────────────────────

test("1.3 an unreadable pause flag is skipped, never published as ok", () => {
  const rows = [{ hour: hours(1)[0], agent: "x", turns: 3, errors: 0 }];
  // registry unreachable ⇒ nothing known about pause
  const skipped = deriveFleetHealth(rows, { pausedByAgent: new Map() });
  assert.equal(skipped.length, 0, "an unjudged agent is not published as a state");

  // opting in shows it, flagged stale with no health claim
  const shown = deriveFleetHealth(rows, { pausedByAgent: new Map(), includeStale: true });
  assert.equal(shown[0].stale, true);
  assert.equal(shown[0].health, null);
});

test("1.3 a known pause flag is not stale", () => {
  const out = deriveFleetHealth([{ hour: hours(1)[0], agent: "x", turns: 3, errors: 3 }], {
    pausedByAgent: new Map([["x", true]]),
  });
  assert.equal(out[0].stale, false);
  assert.equal(out[0].health, HEALTH.PAUSED);
});

// ── 1.4 cause: unknown vs null ──────────────────────────────────────────────

test("1.4 no failure ⇒ cause is null; failure without a known cause ⇒ unknown", () => {
  assert.equal(deriveHealth({ rows: [row(hours(1)[0], 3, 0)] }).lastErrorKind, null);
  assert.equal(deriveHealth({ rows: [row(hours(1)[0], 3, 3)] }).lastErrorKind, "unknown");
  assert.equal(deriveHealth({ rows: [row(hours(1)[0], 3, 3, 3)] }).lastErrorKind, "budget");
  assert.equal(deriveHealth({ rows: [row(hours(1)[0], 3, 3)], cause: "cold_start" }).lastErrorKind, "cold_start");
});

// ── 1.5 backtest against the real 2026-10-22 → 11-10 incident ───────────────

test("1.5 backtest: the copilot that died for 19 days is caught; healthy peers are not", () => {
  // The real shape: every turn failed, for weeks. Modelled as a fully-failed
  // window for the victim and a clean window for a peer.
  const victim = Array.from({ length: 24 }, (_, i) =>
    ({ hour: `2026-11-09T${String(i).padStart(2, "0")}:00`, agent: "lex-console-copilot", turns: 1, errors: 1 }));
  const peer = Array.from({ length: 24 }, (_, i) =>
    ({ hour: `2026-11-09T${String(i).padStart(2, "0")}:00`, agent: "healthy-peer", turns: 2, errors: 0 }));

  const out = deriveFleetHealth([...victim, ...peer], {
    pausedByAgent: new Map([["lex-console-copilot", false], ["healthy-peer", false]]),
    failingMinConsecutive: 3,
  });

  const byAgent = Object.fromEntries(out.map((r) => [r.agent, r]));
  assert.equal(byAgent["lex-console-copilot"].health, HEALTH.FAILING);
  assert.equal(byAgent["lex-console-copilot"].consecutive, 24);
  assert.equal(byAgent["healthy-peer"].health, HEALTH.OK);
  assert.equal(byAgent["healthy-peer"].lastErrorKind, null);
  // ordering: the failing agent is first
  assert.equal(out[0].agent, "lex-console-copilot");
});

test("1.5 leading empty hours (current hour not started yet) do NOT end the streak", () => {
  // This is the flap that a live pass surfaced: the newest bucket is written
  // with turns=0 as soon as it is recomputed, which used to read as "recovered"
  // every hour on the hour.
  const h = deriveHealth({
    rows: [
      row("2026-11-10T00:00", 1, 1),
      row("2026-11-10T01:00", 1, 1),
      row("2026-11-10T02:00", 1, 1),
      row("2026-11-10T03:00", 0, 0), // current hour, no traffic yet
    ],
    failingMinConsecutive: 3,
  });
  assert.equal(h.health, HEALTH.FAILING);
  assert.equal(h.consecutive, 3);
  assert.equal(h.since, hourKeyToMs("2026-11-10T00:00"));
});

test("1.5 an idle hour ends the streak — absence is not failure", () => {
  const h = deriveHealth({
    rows: [row("2026-11-10T01:00", 5, 5), row("2026-11-10T02:00", 0, 0), row("2026-11-10T03:00", 5, 5)],
    failingMinConsecutive: 6,
  });
  assert.equal(h.consecutive, 5, "only the newest run counts");
  assert.notEqual(h.health, HEALTH.FAILING);
});
