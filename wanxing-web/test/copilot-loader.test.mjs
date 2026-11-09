// ── copilot.js loader (unify-cross-line-copilot 2.1/2.2/2.3) ────────────────
//
// The loader is the HOST: it resolves the line's binding, decides whether to
// inject at all, and runs the whole wx-copilot-* protocol. These tests execute
// the real public/copilot.js against a minimal fake DOM, so the behaviours that
// used to be verified by clicking around are regression-covered:
//
//   · unbound / unknown / paused / closed  → NOTHING injected, one warning
//   · ready                                → iframe with the resolved slug
//   · wx-copilot-state                     → the frame shrinks/expands with the
//                                            widget (a full-height transparent
//                                            frame would eat host-page clicks)
//   · identity-request                     → the host hook's token is relayed
//   · intent                               → only declared verbs dispatch
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const SRC = readFileSync(path.resolve(import.meta.dirname, "../public/copilot.js"), "utf8");
const ORIGIN = "https://wanxing.test";

// ── Fake DOM: only what copilot.js touches ─────────────────────────────────
function makeEnv({ resolution, hooks = {} } = {}) {
  const appended = [];
  const warnings = [];
  const listeners = [];
  const script = { src: `${ORIGIN}/copilot.js`, getAttribute: (k) => (k === "data-line" ? "lex" : k === "data-open" ? "1" : null) };

  const el = () => ({
    tagName: "IFRAME",
    style: { cssText: "", height: "" },
    attrs: {},
    contentWindow: { postMessage: (msg, origin) => posted.push({ msg, origin }) },
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { this.removed = true; },
  });
  const posted = [];

  // window === globalThis here, so the loader's one-shot guard would survive
  // between tests: reset the host namespace before each run.
  delete globalThis.WanxingCopilot;

  globalThis.window = globalThis;
  globalThis.location = { href: "https://lex.test/console" };
  globalThis.console = { warn: (m) => warnings.push(String(m)), log: () => {}, error: () => {} };
  globalThis.addEventListener = (type, fn) => listeners.push({ type, fn });
  globalThis.fetch = async () =>
    new Response(JSON.stringify(resolution), { status: 200, headers: { "Content-Type": "application/json" } });

  globalThis.document = {
    get currentScript() { return script; },
    body: { appendChild: (n) => appended.push(n) },
    createElement: (tag) => (tag === "iframe" ? el() : { tagName: String(tag).toUpperCase() }),
    querySelector: () => null,
  };

  Object.assign(globalThis, hooks);
  return { appended, warnings, listeners, posted, run: () => vm.runInThisContext(SRC) };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

test("2.1 unbound: nothing is injected and the reason is logged once", async () => {
  const env = makeEnv({ resolution: { line: "lex", state: "unbound" } });
  env.run();
  await tick();
  assert.equal(env.appended.length, 0, "no surface is injected for an unbound line");
  assert.equal(env.warnings.length, 1);
  assert.match(env.warnings[0], /unbound/);
});

test("2.1 closed: a paused line injects nothing either", async () => {
  const env = makeEnv({ resolution: { line: "lex", state: "closed", reason: "agent_paused" } });
  env.run();
  await tick();
  assert.equal(env.appended.length, 0);
  assert.match(env.warnings[0], /agent_paused/);
});

test("2.1 ready: the iframe carries the resolved slug and the line accent", async () => {
  const env = makeEnv({
    resolution: { line: "lex", state: "ready", agent: { slug: "packs-x-lex", name: "Lex", description: "" }, theme: { accent: "#1d4ed8" }, anonymous: "open" },
  });
  env.run();
  await tick();
  assert.equal(env.appended.length, 1);
  const frame = env.appended[0];
  assert.match(frame.src, new RegExp(`^${ORIGIN}/#/embed/packs-x-lex\\?`));
  assert.match(frame.src, /accent=%231d4ed8/);
  assert.equal(frame.attrs["data-wanxing-copilot"], "packs-x-lex");
  // Initial size rides cssText (one write for the whole fixed-position box).
  assert.match(frame.style.cssText, /height:640px/);
});

test("2.2 state: the frame shrinks with the widget so it cannot eat host clicks", async () => {
  const env = makeEnv({
    resolution: { line: "lex", state: "ready", agent: { slug: "packs-x-lex", name: "Lex" }, theme: {}, anonymous: "open" },
  });
  env.run();
  await tick();
  const frame = env.appended[0];
  const onMessage = env.listeners.find((l) => l.type === "message").fn;
  onMessage({ origin: ORIGIN, source: frame.contentWindow, data: { slug: "packs-x-lex", type: "wx-copilot-state", open: false } });
  assert.equal(frame.style.height, "80px");
  onMessage({ origin: ORIGIN, source: frame.contentWindow, data: { slug: "packs-x-lex", type: "wx-copilot-state", open: true } });
  assert.equal(frame.style.height, "640px");
});

test("2.2 ready handshake declares only the host's verbs; identity is relayed per request", async () => {
  const env = makeEnv({
    resolution: { line: "lex", state: "ready", agent: { slug: "packs-x-lex", name: "Lex" }, theme: {}, anonymous: "login_required" },
    hooks: { WanxingCopilot: { identify: () => ({ token: "id-token-1" }), intents: { navigate: () => {} } } },
  });
  env.run();
  await tick();
  const frame = env.appended[0];
  const onMessage = env.listeners.find((l) => l.type === "message").fn;

  onMessage({ origin: ORIGIN, source: frame.contentWindow, data: { slug: "packs-x-lex", type: "wx-copilot-ready" } });
  const init = env.posted.find((p) => p.msg.type === "wx-copilot-init");
  assert.deepEqual(init.msg.intents, ["navigate"], "undeclared verbs never reach the widget");
  assert.equal(init.origin, ORIGIN);

  onMessage({ origin: ORIGIN, source: frame.contentWindow, data: { slug: "packs-x-lex", type: "wx-copilot-identity-request" } });
  await tick();
  const id = env.posted.find((p) => p.msg.type === "wx-copilot-identity");
  assert.equal(id.msg.token, "id-token-1");
});

test("2.3 no identify hook: null is relayed so the widget uses its own tier", async () => {
  const env = makeEnv({
    resolution: { line: "lex", state: "ready", agent: { slug: "packs-x-lex", name: "Lex" }, theme: {}, anonymous: "login_required" },
  });
  env.run();
  await tick();
  const frame = env.appended[0];
  const onMessage = env.listeners.find((l) => l.type === "message").fn;
  onMessage({ origin: ORIGIN, source: frame.contentWindow, data: { slug: "packs-x-lex", type: "wx-copilot-identity-request" } });
  await tick();
  assert.equal(env.posted.find((p) => p.msg.type === "wx-copilot-identity").msg.token, null);
});

test("2.2 intent: a declared verb dispatches; an undeclared one is refused with a reason", async () => {
  let navigated = null;
  const env = makeEnv({
    resolution: { line: "lex", state: "ready", agent: { slug: "packs-x-lex", name: "Lex" }, theme: {}, anonymous: "open" },
    hooks: { WanxingCopilot: { intents: { navigate: (arg) => { navigated = arg; } } } },
  });
  env.run();
  await tick();
  const frame = env.appended[0];
  const onMessage = env.listeners.find((l) => l.type === "message").fn;

  onMessage({ origin: ORIGIN, source: frame.contentWindow, data: { slug: "packs-x-lex", type: "wx-copilot-intent", askId: "a1", questionId: "q", verb: "navigate", arg: "/console/usage" } });
  await tick();
  assert.equal(navigated, "/console/usage");
  assert.equal(env.posted.find((p) => p.msg.type === "wx-copilot-intent-result").msg.ok, true);

  onMessage({ origin: ORIGIN, source: frame.contentWindow, data: { slug: "packs-x-lex", type: "wx-copilot-intent", askId: "a2", questionId: "q", verb: "highlight", arg: "#x" } });
  await tick();
  const last = env.posted.filter((p) => p.msg.type === "wx-copilot-intent-result").at(-1);
  assert.equal(last.msg.ok, false);
  assert.match(last.msg.message, /不支持/);
});

test("2.2 a message from another origin is ignored", async () => {
  const env = makeEnv({
    resolution: { line: "lex", state: "ready", agent: { slug: "packs-x-lex", name: "Lex" }, theme: {}, anonymous: "open" },
    hooks: { WanxingCopilot: { intents: { navigate: () => {} } } },
  });
  env.run();
  await tick();
  const frame = env.appended[0];
  const onMessage = env.listeners.find((l) => l.type === "message").fn;
  onMessage({ origin: "https://evil.test", source: frame.contentWindow, data: { slug: "packs-x-lex", type: "wx-copilot-ready" } });
  assert.equal(env.posted.length, 0);
});
