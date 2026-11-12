#!/usr/bin/env node
// ── Env names documented must exist in code ─────────────────────────────────
//
// close-wanxing-domain-linkage 4.3: the discoverable variable list (README's
// borrowing-contract section + the wanxing-borrowed-contracts spec) is only
// worth having if every name in it is real. This test extracts the env names
// those two documents name and asserts each one is actually read somewhere
// under services/ — a renamed or removed variable fails here instead of
// misleading the next person who greps for it.
//
// The reverse direction (a variable read in code but absent from the declared
// table) belongs to unify-wanxing-shared-semantics' env.js checker.
//
//   node --test scripts/test-env-doc-coverage.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

// The main spec AND the in-flight delta: the five-boundary table is introduced
// by close-wanxing-domain-linkage, so before that change is archived the truth
// lives in the delta. Reading both keeps this check honest in either state.
const SPEC = path.join(ROOT, "openspec", "specs", "wanxing-borrowed-contracts", "spec.md");
const SPEC_DELTA = path.join(
  ROOT, "openspec", "changes", "close-wanxing-domain-linkage", "specs", "wanxing-borrowed-contracts", "spec.md",
);
const DOCS = [path.join(ROOT, "README.md"), SPEC, SPEC_DELTA].filter((f) => existsSync(f));

// An env-var-shaped token: SCREAMING_SNAKE with at least one underscore.
const ENV_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

// Tokens that look like env names but are prose/identifiers in these docs.
const NOT_ENV = new Set([
  "ADR_0001", "ADR_0005", "ADR_0006", "ADR_0015", "ADR_0022",
  "X_CONTRACT_REV", "HTTP_ONLY", "WX_COPILOT",
]);

function envNamesIn(file) {
  const text = readFileSync(file, "utf8");
  const names = new Set();
  for (const m of text.matchAll(ENV_RE)) {
    const name = m[0];
    if (NOT_ENV.has(name)) continue;
    if (name.length < 6) continue;
    names.add(name);
  }
  return names;
}

function sourceText() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(m?js|json)$/.test(entry)) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(path.join(ROOT, "services"));
  return out.join("\n");
}

test("4.3 every env name the docs declare is actually read in services/", () => {
  const src = sourceText();
  const missing = [];
  const seen = [];

  for (const doc of DOCS) {
    for (const name of envNamesIn(doc)) {
      seen.push(`${path.basename(doc)}:${name}`);
      if (!src.includes(name)) missing.push(`${path.basename(path.dirname(doc))}/${path.basename(doc)} → ${name}`);
    }
  }

  assert.ok(seen.length >= 8, `expected the docs to name a real variable list, found ${seen.length}: ${seen.join(", ")}`);
  assert.deepEqual(missing, [], `documented but never read in code:\n  ${missing.join("\n  ")}`);
});

test("4.3 the five borrowed boundaries are all declared", () => {
  const spec = [SPEC, SPEC_DELTA].filter((f) => existsSync(f)).map((f) => readFileSync(f, "utf8")).join("\n");
  for (const needle of ["registry", "packs", "sub2api", "agent-runner", "FACET_BASE_URL"]) {
    assert.ok(spec.includes(needle), `the borrowed-boundary list is missing: ${needle}`);
  }
  // The per-component families must be spelled out, not just one side of them.
  for (const needle of ["AGENT_SERVING_REGISTRY_URL", "FLEET_REGISTRY_URL"]) {
    assert.ok(spec.includes(needle), `the registry variable families must both be listed: ${needle}`);
  }
});
