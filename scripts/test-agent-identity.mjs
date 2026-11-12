#!/usr/bin/env node
// ── Agent identity fixture conformance ──────────────────────────────────────
//
// unify-wanxing-shared-semantics 1.2/2.4: contracts/agent-identity.fixture.json
// pins the public agent identity rule. Every implementation runs it — this is
// the in-repo implementation's turn. A mismatch prints input / expect / actual
// so the failing case is obvious without reading the fixture.
//
//   node --test scripts/test-agent-identity.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const { slugFor } = await import("../services/wanxing-facade/identity.js");

const fixture = JSON.parse(readFileSync(path.join(ROOT, "contracts", "agent-identity.fixture.json"), "utf8"));

test("identity: the fixture file declares a revision and real cases", () => {
  assert.equal(typeof fixture["x-contract-rev"], "string");
  assert.match(fixture["x-contract-rev"], /^\d+$/);
  assert.ok(Array.isArray(fixture.cases) && fixture.cases.length >= 10,
    `expected a meaningful case list, got ${fixture.cases?.length}`);
  for (const c of fixture.cases) {
    assert.equal(typeof c.input, "string", `case input must be a string: ${JSON.stringify(c)}`);
    assert.equal(typeof c.expect, "string", `case expect must be a string: ${JSON.stringify(c)}`);
  }
});

test("identity: every fixture case matches the in-repo implementation", () => {
  const failures = [];
  for (const c of fixture.cases) {
    const actual = slugFor(c.input);
    if (actual !== c.expect) {
      failures.push(`input=${JSON.stringify(c.input)} expect=${JSON.stringify(c.expect)} actual=${JSON.stringify(actual)}  (${c.note ?? ""})`);
    }
  }
  assert.deepEqual(failures, [], `identity fixture mismatches:\n  ${failures.join("\n  ")}`);
});

test("identity: the two adversarial cases stay pinned together", () => {
  // These two encode the SAME regex from opposite directions. Testing only one
  // of them lets half the semantics drift unnoticed: a run of disallowed
  // characters collapses to one hyphen, while an allowed hyphen survives
  // between runs and accumulates.
  assert.equal(slugFor("a//b"), "a-b");
  assert.equal(slugFor("a - b"), "a---b");
  // If someone "tidies up" duplicate hyphens, the second assertion must break.
  assert.notEqual(slugFor("a - b"), "a-b");
});

test("identity: the rule is idempotent on its own output", () => {
  for (const c of fixture.cases) {
    assert.equal(slugFor(c.expect), c.expect, `not idempotent for ${JSON.stringify(c.expect)}`);
  }
});

test("identity: one implementation in this repo (no stray copies)", () => {
  // The judgement is by EXPRESSION, not by declaration name: an inlined copy
  // inside a map body has no function name (console.js had one), and counting
  // by name is exactly how it went unnoticed. RUNNER_ID_RE in devices.js is a
  // runner-id pattern that shares the character class — whitelisted by name.
  const EXPR = /A-Za-z0-9\._\-/;
  const ALLOWED = new Set([
    path.join("services", "wanxing-facade", "identity.js"), // the one implementation
    path.join("services", "wanxing-facade", "devices.js"),  // RUNNER_ID_RE, not an identity rule
  ]);

  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.m?js$/.test(entry.name)) continue;
      const rel = path.relative(ROOT, full);
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(full, "utf8");
      for (const [i, line] of src.split("\n").entries()) {
        if (line.trimStart().startsWith("//")) continue; // comments may quote the rule
        if (EXPR.test(line) && line.includes("replace(")) {
          offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
  };
  walk(path.join(ROOT, "services"));

  assert.deepEqual(offenders, [],
    `a second identity derivation appeared (route it through identity.js):\n  ${offenders.join("\n  ")}`);
});

test("identity: the allowed exception really is a different rule", () => {
  // Guards against the whitelist rotting: if devices.js stops being a
  // runner-id pattern, the allowance above is stale and must be removed.
  const src = readFileSync(path.join(ROOT, "services", "wanxing-facade", "devices.js"), "utf8");
  assert.ok(src.includes("RUNNER_ID_RE"), "the devices.js exception no longer holds — drop the whitelist entry");
});
