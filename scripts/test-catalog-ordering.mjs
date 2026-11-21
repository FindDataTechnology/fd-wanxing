#!/usr/bin/env node
// Activity ordering (sharpen-wanxing-first-impression 1.1 / 2.1 / 2.3).
//
// Pure function, so the rule is testable without driving routes. The route
// wiring (order before paging, counts unchanged) is asserted in
// test-public-contract.mjs where the harness already lives.
//
//   node --test scripts/test-catalog-ordering.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

const { orderByActivity } = await import("../services/wanxing-facade/a2a.js");

const row = (slug, over = {}) => ({ slug, name: slug, status: "serving", turns7d: 0, ...over });
const slugs = (rows) => rows.map((r) => r.slug);

test("featured leads every non-featured entry", () => {
  const out = orderByActivity([
    row("serving-9", { turns7d: 9 }),
    row("featured-idle", { featured: true, status: "idle" }),
  ]);
  assert.deepEqual(slugs(out), ["featured-idle", "serving-9"]);
});

test("serving before idle before unknown before paused", () => {
  const out = orderByActivity([
    row("p", { status: "paused" }),
    row("u", { status: "unknown" }),
    row("i", { status: "idle" }),
    row("s", { status: "serving" }),
  ]);
  assert.deepEqual(slugs(out), ["s", "i", "u", "p"]);
});

test("within a group, more turns first", () => {
  const out = orderByActivity([row("two", { turns7d: 2 }), row("nine", { turns7d: 9 })]);
  assert.deepEqual(slugs(out), ["nine", "two"]);
});

test("equal group and equal turns is decided by name, not input order", () => {
  const a = orderByActivity([row("beta", { name: "beta" }), row("alpha", { name: "alpha" })]);
  const b = orderByActivity([row("alpha", { name: "alpha" }), row("beta", { name: "beta" })]);
  assert.deepEqual(slugs(a), ["alpha", "beta"]);
  assert.deepEqual(slugs(a), slugs(b), "same data must yield the same order regardless of input order");
});

test("ordering never filters or mutates the input", () => {
  const input = [row("p", { status: "paused" }), row("s", { turns7d: 3 })];
  const snapshot = JSON.stringify(input);
  const out = orderByActivity(input);
  assert.equal(out.length, input.length);
  assert.equal(JSON.stringify(input), snapshot, "input array must not be mutated");
});

test("an unknown status ranks with unknown rather than being dropped", () => {
  const out = orderByActivity([row("weird", { status: "banana" }), row("idle1", { status: "idle" })]);
  assert.equal(out.length, 2);
  assert.deepEqual(slugs(out), ["idle1", "weird"]);
});
