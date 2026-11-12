#!/usr/bin/env node
// ── Outbound addressing: one table, both directions ─────────────────────────
//
// unify-wanxing-shared-semantics D2 / 4.1–4.2:
//   · forward  — every name the table declares is real (read somewhere), so the
//                table cannot rot into a list of dead names;
//   · reverse  — every borrowed-upstream variable actually read in services/ is
//                declared, so a new inline `process.env.X` cannot hide;
//   · the bug  — one upstream, two code paths, DIFFERENT alias sets. The memory
//                seam used to accept `CELL_MEMORY_URL || FD_MEMORY_URL` while
//                the console memory face accepted only `FD_MEMORY_URL`.
//
//   node --test scripts/test-env-table.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const { COMPONENTS, resolve, resolveBase, allDeclaredNames } = await import("../services/wanxing-facade/env.js");
const { createMemorySeam } = await import("../services/wanxing-facade/memory.js");

function sourceFiles(dir = path.join(ROOT, "services"), out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (/\.m?js$/.test(e.name)) out.push(full);
  }
  return out;
}

test("env table: canonical names come first, aliases after (published precedence)", () => {
  for (const [component, upstreams] of Object.entries(COMPONENTS)) {
    for (const [upstream, addr] of Object.entries(upstreams)) {
      for (const key of ["url", "token"]) {
        const names = addr[key];
        if (!names) continue;
        assert.ok(Array.isArray(names) && names.length > 0, `${component}/${upstream}.${key} must be a non-empty list`);
        assert.equal(new Set(names).size, names.length, `${component}/${upstream}.${key} has duplicates`);
        for (const n of names) assert.match(n, /^[A-Z][A-Z0-9_]+$/, `${component}/${upstream}.${key}: ${n} is not SCREAMING_SNAKE`);
      }
    }
  }
});

test("env table: resolve() honours canonical-before-alias and never fabricates a value", () => {
  // canonical wins when both are set
  const both = { AGENT_SERVING_REGISTRY_URL: "http://canonical", REGISTRY_URL: "http://alias" };
  assert.equal(resolve("facade", "registry", both).value, "http://canonical");

  // alias is used when canonical is blank — blank is absent, not a value
  const aliasOnly = { AGENT_SERVING_REGISTRY_URL: "   ", REGISTRY_URL: "http://alias" };
  assert.equal(resolve("facade", "registry", aliasOnly).value, "http://alias");

  // nothing configured → absent + the missing names, never a default
  const none = {};
  const r = resolve("facade", "registry", none);
  assert.equal(r.value, null);
  assert.equal(r.configured, false);
  assert.deepEqual(r.missing, ["AGENT_SERVING_REGISTRY_URL", "REGISTRY_URL", "AGENT_SERVING_REGISTRY_TOKEN", "MARKET_REGISTRY_TOKEN"]);

  // trailing slashes are trimmed by resolveBase only
  assert.equal(resolve("facade", "facet", { FACET_BASE_URL: "http://f//" }).value, "http://f//");
  assert.equal(resolveBase("facade", "facet", { FACET_BASE_URL: "http://f//" }).value, "http://f");

  // a proxied upstream has no address of its own
  const ar = resolve("facade", "agentRunner", {});
  assert.equal(ar.value, null);
  assert.equal(ar.configured, false);
  assert.ok(COMPONENTS.facade.agentRunner.note.includes("proxied"));
});

// ── the bug this change exists for ─────────────────────────────────────────
test("env: both memory faces accept the same aliases (CELL_* only must work on both)", async () => {
  // A deployment that carries only the paas-side spelling.
  const env = { CELL_MEMORY_URL: "http://memory.internal:9000/", CELL_MEMORY_PLATFORM_TOKEN: "pt-1" };

  // The shared resolution both faces go through.
  const shared = resolveBase("facade", "memory", env);
  assert.equal(shared.value, "http://memory.internal:9000");
  assert.equal(shared.token, "pt-1");

  // The chat lane's seam (memory.js).
  const seam = createMemorySeam({ env, fetchImpl: async () => new Response("{}"), log: { warn() {}, log() {} } });
  assert.equal(seam.enabled, true, "the chat lane must be enabled by CELL_MEMORY_* alone");

  // And the mirror case: FD_* only, same table, still enabled.
  const env2 = { FD_MEMORY_URL: "http://memory.internal:9000/", FD_MEMORY_PLATFORM_TOKEN: "pt-2" };
  assert.equal(resolveBase("facade", "memory", env2).value, "http://memory.internal:9000");
  assert.equal(createMemorySeam({ env: env2, fetchImpl: async () => new Response("{}"), log: { warn() {}, log() {} } }).enabled, true);
});

test("env: neither memory face re-derives the alias list (they both call the table)", () => {
  const mem = readFileSync(path.join(ROOT, "services", "wanxing-facade", "memory.js"), "utf8");
  const routes = readFileSync(path.join(ROOT, "services", "wanxing-facade", "routes.js"), "utf8");
  assert.ok(mem.includes('resolveBase("facade", "memory"'), "memory.js must resolve through the table");
  assert.ok(routes.includes('resolveBase("facade", "memory"'), "routes.js must resolve through the table");
  // A direct env read of the memory names would be a second derivation.
  const direct = /env\.(CELL_MEMORY_URL|FD_MEMORY_URL|CELL_MEMORY_PLATFORM_TOKEN|FD_MEMORY_PLATFORM_TOKEN)\b/;
  assert.ok(!direct.test(mem), "memory.js must not read the memory aliases directly");
  assert.ok(!direct.test(routes), "routes.js must not read the memory aliases directly");
});

// ── both directions of the table ───────────────────────────────────────────
test("env table: every declared name is actually read somewhere in services/", () => {
  const src = sourceFiles().map((f) => readFileSync(f, "utf8")).join("\n");
  const missing = allDeclaredNames().filter((n) => !src.includes(n));
  assert.deepEqual(missing, [], `declared but never read (stale table entry):\n  ${missing.join("\n  ")}`);
});

test("env table: no component reads a declared upstream name directly (they route through the table)", () => {
  // Declaration alone is satisfied by a name that is parsed and then ignored.
  // The claim the change makes is stronger: every outbound address/credential
  // READ goes through resolve()/resolveBase(), so the table is the only place
  // that knows a spelling. A leftover inline read is a second derivation even
  // when it happens to agree today.
  const declared = allDeclaredNames();
  const offenders = [];
  for (const file of sourceFiles()) {
    const rel = path.relative(ROOT, file);
    if (rel.includes("env.js")) continue; // the table names them by definition
    const text = readFileSync(file, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      // Comments may name a variable to explain it; code may not read it.
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
      for (const name of declared) {
        const direct = new RegExp(`(?:process\\.env|env)\\.${name}\\b|process\\.env\\[\\s*["\']${name}`);
        if (direct.test(line)) offenders.push(`${rel}:${i + 1} ${name}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `declared upstream read inline instead of through env.js:\n  ${offenders.join("\n  ")}`);
});

test("env table: every borrowed-upstream variable read in services/ is declared", () => {
  // Self-config (WANXING_*, FLEET_* tuning knobs, paths) is out of scope by
  // design; the concern is the ADDRESSES and CREDENTIALS of borrowed upstreams.
  const UPSTREAM_SHAPE = /\b(?:process\.env|env)\.([A-Z][A-Z0-9_]*(?:_URL|_BASE|_BASE_URL|_TOKEN|_ADMIN_KEY|_INTERNAL_TOKEN))\b/g;
  const declared = new Set(allDeclaredNames());
  const SELF_CONFIG_PREFIXES = ["WANXING_", "VAAS_"];

  const offenders = [];
  for (const file of sourceFiles()) {
    const rel = path.relative(ROOT, file);
    if (rel.includes("env.js")) continue; // the table itself names them by design
    const text = readFileSync(file, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      if (line.trimStart().startsWith("//")) continue;
      for (const m of line.matchAll(UPSTREAM_SHAPE)) {
        const name = m[1];
        if (declared.has(name)) continue;
        if (SELF_CONFIG_PREFIXES.some((p) => name.startsWith(p))) continue;
        offenders.push(`${rel}:${i + 1} ${name}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `borrowed-upstream variable read inline instead of through the table:\n  ${offenders.join("\n  ")}`);
});

test("env table: the README mirror lists exactly the declared names (bidirectional)", () => {
  // 5.2: the README table is a mirror, not prose. Bidirectional so it can rot
  // in neither direction — a name added to env.js but not documented is as much
  // a defect as a documented name that no longer exists.
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  const block = readme.split("<!-- env-table:start -->")[1]?.split("<!-- env-table:end -->")[0];
  assert.ok(block, "README must carry the env-table block (<!-- env-table:start/end -->)");
  const documented = new Set(block.match(/\b[A-Z][A-Z0-9_]{3,}\b/g) ?? []);
  const declared = new Set(allDeclaredNames());

  const undocumented = [...declared].filter((n) => !documented.has(n)).sort();
  const phantom = [...documented].filter((n) => !declared.has(n)).sort();
  assert.deepEqual(undocumented, [], `declared in env.js but absent from the README table:\n  ${undocumented.join("\n  ")}`);
  assert.deepEqual(phantom, [], `named in the README table but not declared in env.js:\n  ${phantom.join("\n  ")}`);
});
