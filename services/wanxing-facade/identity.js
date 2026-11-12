// ── The public agent identity (one implementation, in-repo) ──────────────────
//
// unify-wanxing-shared-semantics D1: this function decides what an agent is
// CALLED on every public surface, so it is a cross-repo contract, not an
// internal detail. Before this module it existed five times inside this repo
// (core, an inline map body in console, selfservice, observer, bookkeeper) and
// four+ more outside it — each free to drift silently.
//
// The behaviour is pinned by contracts/agent-identity.fixture.json, which the
// sibling repos vendor and assert against. Do not "improve" the rule here: the
// fixture describes today's behaviour, including the parts that look odd (a run
// of disallowed characters collapses to ONE hyphen, but an allowed hyphen
// accumulates). Editing the regex means editing the fixture and every consumer.

/**
 * The external agent slug — the deployment's registry path, normalized the same
 * way the runner derives its agent key, lowercased and stable across in-place
 * upgrades (the path carries pack+agent identity).
 */
export function slugFor(agentPath) {
  return String(agentPath || "")
    .replace(/^\/+/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .toLowerCase();
}
