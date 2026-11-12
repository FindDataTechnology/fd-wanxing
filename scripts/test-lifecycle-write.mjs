#!/usr/bin/env node
// ── Lifecycle write rule conformance ────────────────────────────────────────
//
// unify-wanxing-shared-semantics 3.1–3.2: contracts/lifecycle-write.fixture.json
// pins the payload a pause/resume writes. The point of the fixture is the
// RESUME case — the key must be REMOVED, not set to false — because every
// reader tests `=== true`, and a lingering explicit false is a shape nobody
// expects. Two doors write this field (wanxing console, 壹座 packs surface), so
// a divergence here is invisible until they disagree.
//
//   node --test scripts/test-lifecycle-write.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const { pausedEntryFor } = await import("../services/wanxing-facade/lifecycle.js");

const fixture = JSON.parse(readFileSync(path.join(ROOT, "contracts", "lifecycle-write.fixture.json"), "utf8"));

test("lifecycle: the fixture declares a revision and cases", () => {
  assert.match(fixture["x-contract-rev"], /^\d+$/);
  assert.ok(Array.isArray(fixture.cases) && fixture.cases.length >= 4);
  for (const c of fixture.cases) {
    assert.equal(typeof c.name, "string", "every case needs a name");
    assert.equal(typeof c.paused, "boolean", `case ${c.name} needs a boolean target state`);
    assert.ok("entry" in c && "expect" in c, `case ${c.name} needs entry + expect`);
  }
});

test("lifecycle: every fixture case matches the shared rule", () => {
  const failures = [];
  for (const c of fixture.cases) {
    const actual = pausedEntryFor(c.entry, c.paused);
    if (JSON.stringify(actual) !== JSON.stringify(c.expect)) {
      failures.push(`${c.name}\n      expect ${JSON.stringify(c.expect)}\n      actual ${JSON.stringify(actual)}`);
    }
  }
  assert.deepEqual(failures, [], `lifecycle fixture mismatches:\n  ${failures.join("\n  ")}`);
});

test("lifecycle: resuming REMOVES the key (never writes false)", () => {
  const out = pausedEntryFor({ metadata: { paused: true, rhythm: "0 8 * * *" } }, false);
  assert.equal("paused" in out.metadata, false, "resume must delete metadata.paused");
  assert.equal(out.metadata.paused, undefined);
  // The discriminating assertion: a `= false` implementation passes an
  // `=== false` check but fails this one.
  assert.notEqual(out.metadata.paused, false, "resume must not leave an explicit false behind");
  assert.equal(out.metadata.rhythm, "0 8 * * *", "sibling metadata must survive the transition");
});

test("lifecycle: sibling metadata survives both directions", () => {
  const base = { visibility: "public", metadata: { rhythm: "0 8 * * *", model: "m1", runner_id: "r1" } };
  const paused = pausedEntryFor(base, true);
  assert.deepEqual(paused.metadata, { rhythm: "0 8 * * *", model: "m1", runner_id: "r1", paused: true });
  const resumed = pausedEntryFor(paused, false);
  assert.deepEqual(resumed.metadata, { rhythm: "0 8 * * *", model: "m1", runner_id: "r1" });
  // A pause that dropped the rhythm would silently unschedule the agent.
  assert.ok("rhythm" in resumed.metadata);
});

test("lifecycle: the rule is pure (input entry is not mutated)", () => {
  const entry = { metadata: { paused: true, k: "v" } };
  const snapshot = JSON.stringify(entry);
  pausedEntryFor(entry, false);
  pausedEntryFor(entry, true);
  assert.equal(JSON.stringify(entry), snapshot, "pausedEntryFor must not mutate its input");
});

test("lifecycle: the facade's setPaused writes this payload (no local re-derivation)", () => {
  // The facade must route through the shared rule rather than re-implementing
  // it. The judgement is textual on purpose: a second copy is exactly what this
  // change exists to prevent, and it cannot be caught by behaviour alone while
  // both copies happen to agree.
  const src = readFileSync(path.join(ROOT, "services", "wanxing-facade", "console.js"), "utf8");
  assert.ok(src.includes("pausedEntryFor(entry,"), "console.js must call pausedEntryFor");
  assert.ok(!/metadata\s*=\s*\{[^}]*paused:/.test(src), "console.js must not re-derive the metadata payload");
});
