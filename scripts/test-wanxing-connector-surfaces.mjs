#!/usr/bin/env node
// ── 萬星 console · connector surfaces (surface-connector-requirements-in-wanxing)
//
// Two faces, one product question: "can this agent actually run?"
//
//   AgentDetailView.external_systems  — the deployment's external-system
//     requirements. Three facts that must never blur: undeclared (the pack
//     declares nothing), all-wired, and gaps. Within gaps, `optional` must be
//     spelled out: paas never mints an optional binding, so an all-optional gap
//     can never be closed and must not read like a required one.
//
//   OpsView.eventLine                 — the timeline's one operator-readable
//     kind. `connector_identity_unregistered` means the turn's connector call
//     is refused; the code says whose job the repair is. Every other kind keeps
//     its original raw rendering, and an unknown kind is never dropped.
//
// Pure functions + esbuild/react-dom/server, same technique as
// test-market-card-connector-signal.mjs in the parent repo.
//
//   node --test scripts/test-wanxing-connector-surfaces.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const webDir = path.join(root, "wanxing-web");
const esbuildBin = path.join(webDir, "node_modules", ".bin", "esbuild");
const skip = existsSync(esbuildBin)
  ? false
  : "wanxing-web/node_modules not installed (esbuild missing) — run `npm --prefix wanxing-web ci`";

// auth.js (pulled in transitively by OpsView) registers a storage listener at
// module scope. Server-rendering in Node has no window; a one-line shim keeps
// the import graph loadable without pretending to be a browser.
const SHIM = `
const store = () => ({ getItem: () => null, setItem() {}, removeItem() {}, clear() {} });
globalThis.window = globalThis.window ?? {
  addEventListener() {},
  removeEventListener() {},
  location: { href: "", origin: "http://localhost", search: "" },
  sessionStorage: store(),
  localStorage: store(),
};
// auth.js reads the bare localStorage identifier, not window.localStorage.
globalThis.localStorage = globalThis.localStorage ?? globalThis.window.localStorage;
globalThis.sessionStorage = globalThis.sessionStorage ?? globalThis.window.sessionStorage;
`;

const ENTRY = `
import "./.test-connector-surfaces-shim.js";
import { renderToStaticMarkup } from "react-dom/server";
import { ExternalSystemsSection } from "./src/views/AgentDetailView.jsx";
import { eventLine, EVENT_LINE } from "./src/views/console/OpsView.jsx";

const FIX = "https://platform.example.test/settings/connections?panel=connector";
const CASES = {
  undeclared: { facts: undefined, fixUrl: FIX },
  allWired: { facts: { declared: 2, required: 2, wired: 2, missing: [] }, fixUrl: FIX },
  requiredGap: { facts: { declared: 2, required: 2, wired: 1, missing: [{ key: "wms", optional: false }] }, fixUrl: FIX },
  optionalGapOnly: { facts: { declared: 2, required: 0, wired: 0, missing: [{ key: "pos", optional: true }, { key: "pay", optional: true }] }, fixUrl: FIX },
  mixedGap: {
    facts: { declared: 3, required: 2, wired: 1, missing: [{ key: "wms", optional: false }, { key: "pos", optional: true }] },
    fixUrl: FIX,
  },
  noFixLink: { facts: { declared: 1, required: 1, wired: 0, missing: [{ key: "erp", optional: false }] }, fixUrl: null },
};

const out = {};
for (const [name, props] of Object.entries(CASES)) {
  out[name] = renderToStaticMarkup(<ExternalSystemsSection {...props} />);
}

const EVENTS = {
  identityFail: { kind: "connector_identity_unregistered", payload: { code: "register_failed", tier: "anon", status: 503 } },
  identityNoCode: { kind: "connector_identity_unregistered", payload: {} },
  plainTurn: { kind: "turn_started", payload: { trace: "t1" } },
  unknownKind: { kind: "some_future_kind", payload: { a: 1 } },
  weirdPayload: { kind: "connector_identity_unregistered", payload: null },
};

const lines = {};
for (const [name, ev] of Object.entries(EVENTS)) lines[name] = eventLine(ev);

process.stdout.write("---RENDERCHECK---" + JSON.stringify({ markup: out, lines, kinds: Object.keys(EVENT_LINE) }));
`;

let cache = null;
function render() {
  if (cache) return cache;
  const entry = path.join(webDir, ".test-connector-surfaces.jsx");
  const shim = path.join(webDir, ".test-connector-surfaces-shim.js");
  const dir = mkdtempSync(path.join(tmpdir(), "wx-connector-surfaces-"));
  const bundle = path.join(dir, "bundle.cjs");
  try {
    writeFileSync(shim, SHIM, "utf8");
    writeFileSync(entry, ENTRY, "utf8");
    execFileSync(
      esbuildBin,
      [entry, "--bundle", "--platform=node", "--format=cjs", "--loader:.json=json", "--jsx=automatic", `--outfile=${bundle}`, "--log-level=error"],
      { cwd: webDir, stdio: "inherit" },
    );
    const stdout = execFileSync(process.execPath, [bundle], { encoding: "utf8", maxBuffer: 64 << 20 });
    const marker = "---RENDERCHECK---";
    cache = JSON.parse(stdout.slice(stdout.indexOf(marker) + marker.length));
    return cache;
  } finally {
    rmSync(entry, { force: true });
    rmSync(shim, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Agent detail: external systems ──────────────────────────────────────────

test("undeclared reads as 未声明, never as a zero", { skip }, () => {
  const { undeclared, allWired } = render().markup;
  assert.match(undeclared, /未声明/);
  assert.doesNotMatch(undeclared, /需求 0/);
  // The wired case must not share the sentence.
  assert.doesNotMatch(allWired, /未声明/);
});

test("all-wired states the counts and renders no gap rows", { skip }, () => {
  const h = render().markup.allWired;
  assert.match(h, /需求 2 · 已接通 2/);
  assert.doesNotMatch(h, /detail-external-systems-missing/);
  assert.doesNotMatch(h, /detail-external-systems-gaps/);
});

test("a required gap is called out and the key is listed", { skip }, () => {
  const h = render().markup.requiredGap;
  assert.match(h, /缺 1 条必需/);
  assert.match(h, /wms/);
  assert.match(h, /必需/);
  assert.match(h, /data-required-gaps="1"/);
});

test("an all-optional gap says SO — it is not closable and must not read required", { skip }, () => {
  const { optionalGapOnly, mixedGap } = render().markup;
  assert.match(optionalGapOnly, /只缺可选项/);
  assert.match(optionalGapOnly, /不会在部署时铸造/);
  assert.match(optionalGapOnly, /data-required-gaps="0"/);
  // Mixed: the headline counts only the required one, the rows keep both flags.
  assert.match(mixedGap, /缺 1 条必需/);
  assert.match(mixedGap, /data-key="wms" data-optional="0"/);
  assert.match(mixedGap, /data-key="pos" data-optional="1"/);
});

test("the repair link is offered with gaps and omitted without one", { skip }, () => {
  const { requiredGap, allWired, noFixLink } = render().markup;
  assert.match(requiredGap, /settings\/connections\?panel=connector/);
  assert.doesNotMatch(allWired, /settings\/connections/);
  // No origin configured => state the gap, do not render a dead end.
  assert.match(noFixLink, /erp/);
  assert.doesNotMatch(noFixLink, /detail-external-systems-fix/);
});

// ── Ops timeline ────────────────────────────────────────────────────────────

test("the identity-registration event gets a sentence and its deciding facts", { skip }, () => {
  const { identityFail } = render().lines;
  assert.match(identityFail, /访客身份登记未完成/);
  assert.match(identityFail, /会被拒绝/);
  assert.match(identityFail, /code=register_failed/);
  assert.match(identityFail, /tier=anon/);
  assert.match(identityFail, /HTTP 503/);
});

test("other kinds keep their original raw rendering", { skip }, () => {
  const { plainTurn, unknownKind } = render().lines;
  assert.equal(plainTurn, JSON.stringify({ trace: "t1" }));
  assert.equal(unknownKind, JSON.stringify({ a: 1 }));
});

test("a malformed payload degrades instead of blanking the row", { skip }, () => {
  const { identityNoCode, weirdPayload } = render().lines;
  assert.match(identityNoCode, /访客身份登记未完成/);
  assert.doesNotMatch(identityNoCode, /code=/);
  // No payload at all still yields the sentence, not "undefined".
  assert.match(weirdPayload, /访客身份登记未完成/);
  assert.doesNotMatch(weirdPayload, /undefined/);
});

test("exactly one kind is labelled — the table is not a vocabulary", { skip }, () => {
  assert.deepEqual(render().kinds, ["connector_identity_unregistered"]);
});
