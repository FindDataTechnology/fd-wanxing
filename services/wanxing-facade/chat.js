// ── Wanxing facade, chat lane face (add-agent-chat-lane D1/D4/D7;
//    add-embed-copilot-lane D1/D2) ───────────────────────────────────────────
//
// The browser conversation surface: logged-in visitors (tenant identity,
// no console allowlist) chat with chatable public agents, billed by the
// allowance waterfall — platform subsidy first, then the host's allowance,
// never the visitor's own money (the own-key overflow bridge rides the
// EXISTING /a2a route with the pasted key, so this module never sees it).
// Admission, slots, idempotency, and forwarding reuse the same kernel as the
// API lane; the differences are the credential class (ID token vs sk- key),
// the tighter chat-only rate bound, and the settler-resolved ledger rows.
//
// Embed lane (add-embed-copilot-lane): the same turn surface additionally
// accepts two credential shapes — facade-minted ephemeral tokens (anonymous
// visitors, per-agent slug-scoped, HMAC-signed; their own tighter daily
// allowance, NEVER the host allowance, settled by the platform subsidy key)
// and tenant ID tokens from product-line clients on the embed audience
// allowlist (host-relayed identity). verifyVisitor stays the single seam:
// everything downstream keys on visitorSub, with visitor_tier separating the
// two daily buckets in the ledger.

import express from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");
const oneShotTail = () => randomBytes(8).toString("hex");

// ── Ephemeral visitor credentials (embed lane D1) ───────────────────────────
// Stateless HMAC: base64url(payload).base64url(hmac-sha256). The secret is a
// facade env (rotation = new secret; in-flight tokens fail closed and the
// widget re-mints). The payload is slug-scoped — one anonymous identity is
// replayable on exactly the agent it was minted for, so a cleared-storage
// refresh costs scale per-agent, not globally.
const b64uJson = (v) => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");

export function signEphemeral(payload, secret) {
  const body = b64uJson(payload);
  const mac = createHmac("sha256", String(secret)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyEphemeral(token, secret, now = Date.now()) {
  if (!secret || typeof token !== "string") return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expect = createHmac("sha256", String(secret)).update(body).digest();
  let got;
  try { got = Buffer.from(mac, "base64url"); } catch { return null; }
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p || typeof p.vid !== "string" || typeof p.slug !== "string") return null;
    if (!Number.isFinite(p.exp) || p.exp <= now) return null;
    return p;
  } catch {
    return null;
  }
}

// Visitors have no sub2api user id, but the kernel's RPM/slot/idempotency
// machinery keys on a numeric caller id — derive a stable 48-bit one from the
// tenant subject (far outside sub2api's small-integer id space, so the two
// lanes can never collide on a bucket or slot).
export function visitorCallerId(sub) {
  return Number(BigInt(`0x${sha256(String(sub)).slice(0, 12)}`) & 0xffffffffffffn);
}

const textOf = (message) => {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  return text || null;
};

const jsonRpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

// The subsidy day window (platform timezone Asia/Shanghai, design D3):
// returns [startMs, startMs + 24h) containing t.
export function shDayWindow(t = Date.now()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(t));
  const start = Date.parse(`${date}T00:00:00+08:00`);
  return [start, start + 86_400_000];
}

export function createChatFace({
  core,
  store,
  logto = null, // { verifyIdToken } — the tenant gate (allowlist OFF for visitors)
  agentState, // (slug) → { exists, visibility, paused, entry, agentPath } — from the a2a face
  resolveDeployment, // (slug) → { packId, agentId } | null — for host settlement addressing
  forwardHeaders,
  config, // { agentUrlFor(agentPath) }
  hostSettle = null, // ({ packId, agentId, usageId, minutes, rateUsdPerMin }) → { settled, duplicate } | throws (D5)
  sub2api = null, // the platform's admin client — subsidy settlement resolves WANXING_SUBSIDY_KEY's holder
  subsidyKey = "", // the platform settlement key value (env; never logged)
  subsidyUserId = null, // dedicated subsidy account id (env WANXING_SUBSIDY_USER_ID — wins over the key: the dedicated account needs no key credential at all, upstream has no admin-side key minting)
  chat = {}, // { subsidyEnabled, subsidyDailyMinutes, rpmMax, embed: {...} }
  report = null,
  upstreamFetch = fetch,
}) {
  const embed = chat.embed ?? {};
  const cfg = {
    subsidyEnabled: chat.subsidyEnabled ?? false,
    subsidyDailyMinutes: chat.subsidyDailyMinutes ?? 10,
    rpmMax: chat.rpmMax ?? 6,
    // Embed lane (add-embed-copilot-lane D1/D2/D5): anonymous is double-gated
    // (this global switch AND the per-agent deployer switch), settles on the
    // platform subsidy machinery under its own tighter daily allowance, and
    // its credential minting is origin-gated. No embedSecret = the whole
    // anonymous shape is inert (mint refuses, ephemeral tokens unverifiable).
    anonEnabled: embed.anonEnabled ?? false,
    anonDailyMinutes: embed.anonDailyMinutes ?? 3,
    embedSecret: embed.embedSecret || "",
    embedOrigins: [...new Set((embed.embedOrigins ?? []).map((o) => String(o).trim().toLowerCase().replace(/\/+$/, "")).filter(Boolean))],
    embedTtlMs: embed.embedTtlMs ?? 24 * 3600_000,
    mintRpmMax: embed.mintRpmMax ?? 10,
  };

  const note = (kind, agent, payload = {}, id = null) => {
    try {
      report?.({ kind, agent, payload, id });
    } catch { /* observability never breaks a turn */ }
  };

  // Subsidy is admissible only when the switch is on AND a settlement party
  // is wired — half a subsidy config admits no subsidy turns.
  const subsidyOpen = () =>
    cfg.subsidyEnabled && Boolean(subsidyUserId || subsidyKey) && Boolean(sub2api && !sub2api.degraded());

  const hostRemaining = (slug) => {
    const cap = store.hostAllowanceGet(slug);
    if (!cap) return 0;
    return Math.max(0, cap.limitMinutes - store.hostAllowanceUsed(slug));
  };

  const subsidyRemainingToday = (visitorSub) => {
    if (!subsidyOpen()) return 0;
    const [from, to] = shDayWindow();
    return Math.max(0, cfg.subsidyDailyMinutes - store.chatSubsidyUsed(visitorSub, from, to, "tenant"));
  };

  // ── Anonymous admission (embed lane D2) ────────────────────────────────────
  // Settlement readiness mirrors subsidyOpen's wiring check but WITHOUT the
  // tenant subsidy switch — anonymous has its own global gate. The per-agent
  // switch is deployer-managed (store); both default closed.
  const anonSettleReady = () =>
    Boolean(cfg.embedSecret) && Boolean(subsidyUserId || subsidyKey) && Boolean(sub2api && !sub2api.degraded());
  const anonOpenFor = (slug) =>
    cfg.anonEnabled && anonSettleReady() && store.embedSettingsGet(slug)?.anonymous === true;
  // The anon daily bucket needs both the slug (per-agent gate) and the sub —
  // callers from the routes always have both.
  const anonRemainingFor = (slug, visitorSub) => {
    if (!anonOpenFor(slug)) return 0;
    const [from, to] = shDayWindow();
    return Math.max(0, cfg.anonDailyMinutes - store.chatSubsidyUsed(visitorSub, from, to, "anon"));
  };
  // Origins allowed to mint for an agent: the deployer's per-agent list ∪ the
  // platform fallback list. Unconfigured = closed (fail-closed by shape).
  const embedOriginsFor = (slug) => {
    const perAgent = store.embedSettingsGet(slug)?.origins ?? [];
    return new Set([...perAgent.map((o) => String(o).toLowerCase()), ...cfg.embedOrigins]);
  };

  const chatable = (state) =>
    Boolean(state?.exists) && state.visibility !== "private" && !state.paused &&
    (subsidyOpen() || hostRemaining(state.slug) > 0);

  // The waterfall (D4): subsidy first, host allowance second; a chat turn
  // must resolve a settler BEFORE it starts or it is refused with the
  // own-key hint. Waived-visibility nuance: neither level is open.
  const settlerFor = (slug, visitorSub) => {
    if (subsidyRemainingToday(visitorSub) > 0) return "subsidy";
    if (hostRemaining(slug) > 0) return "host";
    return null;
  };

  // Chat-only rolling RPM (mirrors core.checkRpm's semantics, tighter bound).
  const rpmBuckets = new Map(); // callerId → { windowStart, count }
  function checkChatRpm(callerId) {
    const nowTs = Date.now();
    let b = rpmBuckets.get(callerId);
    if (!b || nowTs - b.windowStart >= 60_000) {
      b = { windowStart: nowTs, count: 0 };
      rpmBuckets.set(callerId, b);
    }
    b.count += 1;
    return b.count <= cfg.rpmMax;
  }

  // ── In-flight ask bookkeeping (add-copilot-control-surface D1) ────────────
  // askId → { visitorSub, slug, agentPath, deadlineAt }: minted while
  // relaying an `ask` frame so the answer route can bind the submission to
  // the visitor whose stream carried it, evicted at the ask's deadline.
  // Memory-only by design — an ask lives minutes, and a restart costs one
  // "ask no longer valid" on the widget (the runner deadline-cancels its
  // side either way).
  const relayedAsks = new Map();
  const sweepRelayedAsks = () => {
    const nowTs = Date.now();
    for (const [askId, a] of relayedAsks) if (!(a.deadlineAt > nowTs)) relayedAsks.delete(askId);
  };

  // ── Chat settlement (3.2) ──────────────────────────────────────────────────
  // host rows: the packs internal contract, idempotent by the row id (D5).
  // subsidy rows: deduct the platform settlement key's holder, same shape as
  // the API lane's trySettle (duplicate refusal = settled). Failures leave
  // the row pending — the sweep retries; visitors are never suspended for a
  // settlement that is not theirs.
  let subsidyHolderCache = null; // { at, userId }
  // Accepts both row shapes: the inline path (finish) passes the camelCase
  // row from recordUsage, the sweep passes raw snake_case ledger rows.
  async function settleChatRow(rowIn) {
    const row = {
      ...rowIn,
      minutes_billed: rowIn.minutes_billed ?? rowIn.minutesBilled ?? 0,
      rate_usd: rowIn.rate_usd ?? rowIn.rateUsd ?? 0,
      agent_slug: rowIn.agent_slug ?? rowIn.agentSlug,
    };
    if (row.outcome !== "ok" || !row.minutes_billed) {
      store.usageMarkSettled(row.id);
      return true;
    }
    if (row.settler === "host") {
      if (!hostSettle) return false;
      const dep = await resolveDeployment(row.agent_slug);
      if (!dep) throw Object.assign(new Error(`deployment vanished before host settlement: ${row.agent_slug}`), { retryable: true });
      const out = await hostSettle({
        packId: dep.packId,
        agentId: dep.agentId,
        usageId: row.id,
        minutes: row.minutes_billed,
        rateUsdPerMin: row.rate_usd,
      });
      if (out?.settled) store.usageMarkSettled(row.id);
      return Boolean(out?.settled);
    }
    if (row.settler === "subsidy") {
      if (!subsidyOpen()) throw Object.assign(new Error("subsidy settlement requested but the subsidy is not configured"), { retryable: false });
      let userId = subsidyUserId;
      if (!userId) {
        if (!subsidyHolderCache || Date.now() - subsidyHolderCache.at > 300_000) {
          const holder = await sub2api.findUserByKey(subsidyKey);
          if (!holder) throw Object.assign(new Error("the platform subsidy key no longer resolves to an account"), { retryable: false });
          subsidyHolderCache = { at: Date.now(), userId: holder.userId };
        }
        userId = subsidyHolderCache.userId;
      }
      const amount = Number((row.minutes_billed * row.rate_usd).toFixed(4));
      try {
        await sub2api.adjustBalance({
          userId,
          amountUsd: amount,
          operation: "subtract",
          idempotencyKey: row.id,
        });
        store.usageMarkSettled(row.id);
        return true;
      } catch (e) {
        if (/duplicate|idempoten/i.test(String(e?.message || ""))) {
          store.usageMarkSettled(row.id);
          return true;
        }
        throw e;
      }
    }
    return false;
  }

  // The single identity seam (embed lane D1/D3): a bearer is a tenant ID
  // token (console client OR an embed-allowlist product-line client) or a
  // facade-minted ephemeral token. Tenant shape wins when both could apply.
  // The ephemeral's slug travels with the credential — the routes check it
  // against the addressed agent (cross-agent replay refuses).
  async function verifyVisitor(req) {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!bearer) return null;
    if (logto?.configured) {
      try {
        const ident = await logto.verifyIdToken(bearer, { allowlist: false, acceptEmbedAudiences: true });
        if (ident) return { ...ident, tier: "tenant" };
      } catch { /* allowlist diagnostics never apply on this call shape */ }
    }
    const anon = verifyEphemeral(bearer, cfg.embedSecret);
    if (anon) return { email: "", sub: `anon:${anon.vid}`, tier: "anon", slug: anon.slug };
    return null;
  }

  // Mint-rate bound per source (origin × peer IP): a hostile page must not
  // be able to churn anonymous identities. Rolling 60s, same shape as the
  // chat RPM bucket.
  const mintBuckets = new Map();
  function checkMintRpm(source) {
    const nowTs = Date.now();
    let b = mintBuckets.get(source);
    if (!b || nowTs - b.windowStart >= 60_000) {
      b = { windowStart: nowTs, count: 0 };
      mintBuckets.set(source, b);
    }
    b.count += 1;
    return b.count <= cfg.mintRpmMax;
  }

  function register(app) {
    // ── Chat status (D7): the page's pre-flight. Anonymous callers get the
    // public shape only; a verified visitor additionally sees their own
    // remaining allowance (minutes, never a claim on the host's money).
    app.get("/api/wanxing/v1/chat/:agentSlug/status", async (req, res) => {
      let state;
      try {
        state = await agentState(req.params.agentSlug);
      } catch (e) {
        return res.status(503).json({ error: { code: "DEPLOYMENT_SOURCE_UNAVAILABLE", message: `deployment source unreachable (${String(e?.message || e)})` } });
      }
      if (!state.exists || state.visibility === "private") {
        return res.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "no public agent at this route" } });
      }
      const slug = state.slug;
      const out = {
        chatAble: chatable(state),
        reason: state.paused ? "agent_paused" : (!subsidyOpen() && hostRemaining(slug) <= 0 ? "chat_not_open" : null),
        subsidy: subsidyOpen() ? "on" : "off",
        agent: { name: state.entry?.name ?? slug, description: state.entry?.description ?? "" },
      };
      const visitor = await verifyVisitor(req);
      if (!visitor) return res.json(out);
      if (visitor.tier === "anon") {
        return res.json({
          ...out,
          tier: "anon",
          // An anonymous credential scoped to another agent still answers
          // status (read-only) — the turn surface is where scope refuses.
          anonymousRemainingToday: visitor.slug === slug ? anonRemainingFor(slug, visitor.sub) : 0,
        });
      }
      res.json({
        ...out,
        tier: "tenant",
        subsidyRemainingToday: subsidyRemainingToday(visitor.sub),
        hostPoolRemaining: hostRemaining(slug),
      });
    });

    // ── Embed cold-start config (embed lane D5): the widget's first fetch.
    // Public and secret-free — chatability, anonymous availability, agent
    // display fields. No quota internals, no subsidy state, no keys.
    app.get("/api/wanxing/v1/chat/:agentSlug/embed-config", async (req, res) => {
      let state;
      try {
        state = await agentState(req.params.agentSlug);
      } catch (e) {
        return res.status(503).json({ error: { code: "DEPLOYMENT_SOURCE_UNAVAILABLE", message: `deployment source unreachable (${String(e?.message || e)})` } });
      }
      if (!state.exists || state.visibility === "private") {
        return res.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "no public agent at this route" } });
      }
      res.json({
        chatAble: chatable(state),
        reason: state.paused ? "agent_paused" : (!subsidyOpen() && hostRemaining(state.slug) <= 0 ? "chat_not_open" : null),
        anonymous: anonOpenFor(state.slug),
        agent: { name: state.entry?.name ?? state.slug, description: state.entry?.description ?? "" },
        theme: {},
        // The lane relays in-flight asks and answers them on the side route
        // (add-copilot-control-surface): hosts read this to know an intent
        // confirmation round trip is possible.
        features: { asks: true },
      });
    });

    // ── Ephemeral visitor-token mint (embed lane D1): origin-gated, source
    // rate-bounded, slug-scoped. The mint refuses (rather than issues-then-
    // fails-at-turn) when the anonymous lane is closed — the widget reads
    // that as "show login" instead of "anonymous then 403".
    app.post("/api/wanxing/v1/chat/:agentSlug/visitor-token", express.json({ limit: "4kb" }), async (req, res) => {
      const slug = req.params.agentSlug;
      if (!cfg.embedSecret) {
        return res.status(503).json({ error: { code: "EMBED_NOT_CONFIGURED", message: "the embed lane is not configured on this facade" } });
      }
      let state;
      try {
        state = await agentState(slug);
      } catch (e) {
        return res.status(503).json({ error: { code: "DEPLOYMENT_SOURCE_UNAVAILABLE", message: `deployment source unreachable (${String(e?.message || e)})` } });
      }
      if (!state.exists || state.visibility === "private") {
        return res.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "no public agent at this route" } });
      }
      if (state.paused) {
        return res.status(423).json({ error: { code: "AGENT_PAUSED", message: "this agent is paused" } });
      }
      // The widget passes its attested embedding origin in the body; a
      // FOREIGN browser-set Origin header (a cross-origin direct call)
      // always wins over the claim. But browsers set Origin on EVERY POST —
      // including the widget's own same-origin mint (live finding 2026-10-22:
      // the old "same-origin carries no Origin header" premise was wrong and
      // blocked every widget-minted anonymous credential). The widget's own
      // origin is our trusted code, so when the header's host equals this
      // request's host the call is same-origin and the body claim stands.
      const headerOrigin = String(req.headers.origin || "").trim().toLowerCase().replace(/\/+$/, "");
      const headerHost = (() => { try { return new URL(headerOrigin).host; } catch { return null; } })();
      const sameOriginCall = Boolean(headerOrigin) && headerHost === String(req.headers.host || "").toLowerCase();
      const trustedHeader = headerOrigin && !sameOriginCall ? headerOrigin : "";
      const claimedOrigin = String(req.body?.origin || "").trim().toLowerCase().replace(/\/+$/, "");
      const origin = trustedHeader || (/^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(claimedOrigin) ? claimedOrigin : "");
      if (!origin || !embedOriginsFor(slug).has(origin)) {
        note("refused", slug, { stage: "mint", code: "EMBED_ORIGIN_NOT_ALLOWED", origin: origin || "(none)" });
        return res.status(403).json({ error: { code: "EMBED_ORIGIN_NOT_ALLOWED", message: "this origin is not allowed to embed that agent" } });
      }
      if (!anonOpenFor(slug)) {
        note("refused", slug, { stage: "mint", code: "ANON_NOT_OPEN", origin });
        return res.status(403).json({
          error: { code: "ANON_NOT_OPEN", message: "anonymous conversations are not enabled for this agent", hint: "login to continue", loginUpgrade: true },
        });
      }
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "";
      if (!checkMintRpm(`${origin}|${ip}`)) {
        note("refused", slug, { stage: "mint", code: "RATE_LIMITED", origin });
        return res.status(429).json({ error: { code: "RATE_LIMITED", message: "visitor credential mint rate limit exceeded" } });
      }
      const vid = randomBytes(16).toString("hex");
      const exp = Date.now() + cfg.embedTtlMs;
      const token = signEphemeral({ vid, slug, iat: Date.now(), exp }, cfg.embedSecret);
      note("minted", slug, { origin, tier: "anon" });
      res.status(201).json({ token, tier: "anon", expiresAt: exp, anonymousDailyMinutes: cfg.anonDailyMinutes });
    });

    // ── The chat turn surface. Same admission order as the API lane with the
    // chat substitutions: visitor credential → chatability → chat RPM → slot
    // → settler waterfall → forward (kernel-identical from the slot down).
    app.post("/api/wanxing/v1/chat/:agentSlug", express.json({ limit: "1mb" }), async (req, res) => {
      const slug = req.params.agentSlug;
      const visitor = await verifyVisitor(req);
      if (!visitor) {
        note("refused", slug, { stage: "visitor", code: "VISITOR_AUTH_REQUIRED" });
        return res.status(401).json({ error: { code: "VISITOR_AUTH_REQUIRED", message: "a verified tenant login is required to chat" } });
      }
      // Ephemeral credentials are slug-scoped (embed lane D1): a token minted
      // for one agent never opens another's lane.
      if (visitor.tier === "anon" && visitor.slug !== slug) {
        note("refused", slug, { stage: "visitor", code: "VISITOR_AUTH_REQUIRED", tier: "anon" });
        return res.status(401).json({ error: { code: "VISITOR_AUTH_REQUIRED", message: "this visitor credential was not minted for that agent" } });
      }
      const caller = { userId: visitorCallerId(visitor.sub), email: visitor.email, visitorSub: visitor.sub };

      const { id, method, params } = req.body ?? {};
      if (req.body?.jsonrpc !== "2.0" || typeof method !== "string") {
        return res.status(200).json(jsonRpcError(id, -32600, "Invalid Request"));
      }
      if (method !== "message/send" && method !== "message/stream") {
        return res.status(200).json(jsonRpcError(id, -32601, `Method not found: ${method}`));
      }
      const message = params?.message ?? params;
      const text = textOf(message);
      if (!text) return res.status(200).json(jsonRpcError(id, -32604, "empty message"));

      let state;
      try {
        state = await agentState(slug);
      } catch (e) {
        note("refused", slug, { stage: "source", code: "DEPLOYMENT_SOURCE_UNAVAILABLE", channel: "chat" });
        return res.status(503).json({ error: { code: "DEPLOYMENT_SOURCE_UNAVAILABLE", message: `deployment source unreachable (${String(e?.message || e)})` } });
      }
      if (!state.exists || state.visibility === "private") {
        return res.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "no public agent at this route" } });
      }
      if (state.paused) {
        note("refused", slug, { stage: "admission", code: "AGENT_PAUSED", channel: "chat", caller: visitor.email || visitor.sub });
        return res.status(423).json({ error: { code: "AGENT_PAUSED", message: "this agent is paused" } });
      }

      // Tier-split admission (embed lane D2): anonymous visitors never draw
      // the host allowance — their only settler is the (tighter) anonymous
      // subsidy bucket, and every refusal names the login-upgrade path.
      // Tenant visitors keep the chatability gate and waterfall unchanged.
      let settler = null;
      if (visitor.tier === "anon") {
        if (!anonOpenFor(slug)) {
          note("refused", slug, { stage: "admission", code: "ANON_NOT_OPEN", channel: "chat", tier: "anon" });
          return res.status(403).json({
            error: {
              code: "ANON_NOT_OPEN",
              message: "anonymous conversations are not enabled for this agent",
              hint: "login to continue this conversation",
              loginUpgrade: true,
            },
          });
        }
      } else if (!chatable(state)) {
        note("refused", slug, { stage: "admission", code: "CHAT_NOT_OPEN", channel: "chat", caller: visitor.email || visitor.sub });
        return res.status(403).json({ error: { code: "CHAT_NOT_OPEN", message: "this agent is not open for conversations (no subsidy and no host allowance)" } });
      }

      if (!checkChatRpm(caller.userId)) {
        note("refused", slug, { stage: "rate", code: "RATE_LIMITED", channel: "chat", caller: visitor.email || visitor.sub });
        return res.status(429).json({ error: { code: "RATE_LIMITED", message: "visitor chat rate limit exceeded" } });
      }

      // Settler resolves BEFORE the slot: an exhausted waterfall must not
      // even occupy the concurrency machinery. Anonymous resolves to the
      // subsidy settler only (host money is never spent on anonymous
      // traffic); exhaustion answers the login-upgrade 402.
      settler = visitor.tier === "anon" ? (anonRemainingFor(slug, visitor.sub) > 0 ? "subsidy" : null) : settlerFor(slug, visitor.sub);
      if (!settler) {
        if (visitor.tier === "anon") {
          note("refused", slug, { stage: "settler", code: "ANON_ALLOWANCE_EXHAUSTED", channel: "chat", tier: "anon" });
          return res.status(402).json({
            error: {
              code: "ANON_ALLOWANCE_EXHAUSTED",
              message: "the anonymous daily allowance for this agent is used up",
              hint: "login to continue with a full allowance",
              loginUpgrade: true,
            },
          });
        }
        note("refused", slug, { stage: "settler", code: "CHAT_ALLOWANCE_EXHAUSTED", channel: "chat", caller: visitor.email || visitor.sub });
        return res.status(402).json({
          error: {
            code: "CHAT_ALLOWANCE_EXHAUSTED",
            message: "your free allowance for this agent is used up",
            hint: `continue with your own sub2api key at /api/wanxing/v1/a2a/${slug}`,
          },
        });
      }

      const idemKey = (() => {
        const h = req.headers["idempotency-key"];
        return typeof h === "string" && h.trim() ? h.trim().slice(0, 200) : null;
      })();
      const prior = method === "message/send" ? core.idempotencyState({ callerId: caller.userId, slug, idemKey }) : "new";
      let holdsSlot = false;
      if (prior === "new") {
        if (!core.acquireSlot(caller.userId, slug)) {
          note("refused", slug, { stage: "slot", code: "TURN_IN_FLIGHT", channel: "chat", caller: visitor.email || visitor.sub });
          res.set("Retry-After", "5");
          return res.status(409).json({ error: { code: "TURN_IN_FLIGHT", message: "a turn for this visitor and agent is already running; retry after the hint" } });
        }
        holdsSlot = true;
      }

      // Conversation continuity: the browser supplies the conversation's
      // context_id; a first message without one derives it from the idem key
      // (stable across replays), same as the API lane.
      const supplied = message?.context_id ?? message?.contextId ?? null;
      const contextId = supplied
        ? String(supplied)
        : `wx:chat-${idemKey ? sha256(idemKey).slice(0, 16) : oneShotTail()}`;
      const startedAt = Date.now();
      if (prior !== "done") note("admitted", slug, { caller: visitor.email || visitor.sub, idem_key: idemKey || "", transport: method, channel: "chat", settler, ...(visitor.tier === "anon" ? { tier: "anon" } : {}) });

      const finish = (outcome) => {
        core.releaseSlot(caller.userId, slug);
        const row = core.recordUsage({ caller, slug, idemKey, startedAt, endedAt: Date.now(), outcome, channel: "chat", settler, visitorSub: visitor.sub, visitorTier: visitor.tier });
        if (row.settlementStatus === "waived") {
          note("settled", slug, { minutes_billed: 0, usd: 0, settlement_status: "waived", outcome, channel: "chat", settler }, `facade-${row.id}`);
          return;
        }
        void settleChatRow(row)
          .then((ok) => note("settled", slug, {
            minutes_billed: row.minutesBilled,
            usd: Number((row.minutesBilled * row.rateUsd).toFixed(4)),
            settlement_status: ok ? "settled" : "pending",
            outcome, channel: "chat", settler,
          }, `facade-${row.id}`))
          .catch(() => note("settled", slug, {
            minutes_billed: row.minutesBilled,
            usd: Number((row.minutesBilled * row.rateUsd).toFixed(4)),
            settlement_status: "pending",
            outcome, channel: "chat", settler,
          }, `facade-${row.id}`));
      };
      const exitReadonly = () => {
        if (holdsSlot) core.releaseSlot(caller.userId, slug);
      };

      const rpcBody = (m) => JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: m,
        params: { message: { role: "user", parts: [{ kind: "text", text }], context_id: contextId } },
      });

      try {
        if (method === "message/stream") {
          // Ask opt-in (add-copilot-control-surface): streamed turns declare
          // themselves answer-capable so the serving plane forwards in-flight
          // asks as `ask` events instead of declining them. Synchronous turns
          // never opt in — a message/send caller cannot answer anything.
          const upstream = await upstreamFetch(config.agentUrlFor(state.agentPath), {
            method: "POST",
            headers: { ...forwardHeaders(), "Content-Type": "application/json", "X-Serving-Ask": "1" },
            body: rpcBody("message/stream"),
          });
          const ctype = upstream.headers.get("content-type") || "";
          if (!upstream.ok || !ctype.includes("text/event-stream")) {
            const body = await upstream.text().catch(() => "");
            finish("error");
            return res.status(502).json({ error: { code: "UPSTREAM_FAILED", message: `agent route refused the turn: ${body.slice(0, 200) || upstream.status}` } });
          }
          res.status(200).set("Content-Type", "text/event-stream").set("Cache-Control", "no-cache");
          let outcome = "ok";
          try {
            const reader = upstream.body.getReader();
            const decoder = new TextDecoder();
            // Byte-verbatim relay with a line scanner riding alongside (the
            // old whole-chunk error regex tolerated torn frames; the scanner
            // does not): `event: ask` frames bind the ask id to THIS visitor
            // so the answer route can refuse everyone else. Keepalive comment
            // frames pass through untouched and land nowhere.
            let sseBuf = "";
            let inAskEvent = false;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              const frame = decoder.decode(value, { stream: true });
              res.write(frame);
              sseBuf += frame;
              let nl;
              while ((nl = sseBuf.indexOf("\n")) >= 0) {
                const line = sseBuf.slice(0, nl).trim();
                sseBuf = sseBuf.slice(nl + 1);
                if (/^event:\s*error/.test(line)) {
                  outcome = "error";
                } else if (/^event:\s*ask\s*$/.test(line)) {
                  inAskEvent = true;
                } else if (inAskEvent && line.startsWith("data:")) {
                  inAskEvent = false;
                  try {
                    const doc = JSON.parse(line.slice(5).trim());
                    const deadlineAt = Number(doc?.deadlineAt);
                    if (typeof doc?.askId === "string" && doc.askId && Number.isFinite(deadlineAt) && deadlineAt > Date.now()) {
                      relayedAsks.set(doc.askId, { visitorSub: visitor.sub, slug, agentPath: state.agentPath, deadlineAt });
                    }
                  } catch { /* a torn ask frame binds nothing */ }
                }
              }
            }
          } catch {
            outcome = "error";
          } finally {
            res.end();
            finish(outcome);
          }
          return;
        }

        const out = await core.idempotentSend({
          callerId: caller.userId,
          slug,
          idemKey,
          exec: async () => {
            const upstream = await upstreamFetch(config.agentUrlFor(state.agentPath), {
              method: "POST",
              headers: { ...forwardHeaders(), "Content-Type": "application/json" },
              body: rpcBody("message/send"),
            });
            const doc = await upstream.json().catch(() => null);
            if (!upstream.ok) {
              throw Object.assign(new Error(`agent route refused the turn (${upstream.status})`), { code: -32033 });
            }
            return { response: doc ?? { jsonrpc: "2.0", id: id ?? null, error: { code: -32001, message: "agent route returned an unreadable response" } } };
          },
        });
        // Same outcome derivation as the API lane (fix-error-turn-billing):
        // the A2A transport carries model-failed turns as HTTP 200 + a
        // JSON-RPC error object — error turns are recorded but waived, and
        // the channel settler is never invoked for them.
        if (!out.replayed) finish(out.response?.error ? "error" : "ok");
        else exitReadonly();
        res.status(200).json(out.response);
      } catch (e) {
        if (holdsSlot) finish("error");
        else exitReadonly();
        res.status(200).json(jsonRpcError(id, Number.isInteger(e?.code) ? e.code : -32032, String(e?.message || e)));
      }
    });

    // ── Ask answers (add-copilot-control-surface D1): the widget answers an
    // in-flight ask through the same visitor gate as the turn itself. The
    // facade binds each relayed ask to the visitor whose stream carried it —
    // unknown, expired, or foreign ask ids are a structured not-found and
    // nothing is forwarded. First-wins at the facade too: one accepted
    // submission per ask (the runner's own empty-table semantics stay the
    // second gate). Answers ride the chat RPM bound but are NOT metered —
    // the answered turn is already metered by its stream.
    app.post("/api/wanxing/v1/chat/:agentSlug/ask-answer", express.json({ limit: "16kb" }), async (req, res) => {
      const slug = req.params.agentSlug;
      const visitor = await verifyVisitor(req);
      if (!visitor) {
        note("refused", slug, { stage: "visitor", code: "VISITOR_AUTH_REQUIRED", channel: "ask-answer" });
        return res.status(401).json({ error: { code: "VISITOR_AUTH_REQUIRED", message: "a verified visitor credential is required to answer" } });
      }
      if (visitor.tier === "anon" && visitor.slug !== slug) {
        note("refused", slug, { stage: "visitor", code: "VISITOR_AUTH_REQUIRED", tier: "anon", channel: "ask-answer" });
        return res.status(401).json({ error: { code: "VISITOR_AUTH_REQUIRED", message: "this visitor credential was not minted for that agent" } });
      }
      const body = req.body ?? {};
      const askId = typeof body.askId === "string" ? body.askId : "";
      const cancelled = body.cancelled === true;
      if (!askId || (!cancelled && !Array.isArray(body.answers))) {
        return res.status(400).json({ error: { code: "ASK_BAD_REQUEST", message: "askId plus answers[] or cancelled:true required" } });
      }
      if (!checkChatRpm(visitorCallerId(visitor.sub))) {
        return res.status(429).json({ error: { code: "RATE_LIMITED", message: "visitor chat rate limit exceeded" } });
      }
      sweepRelayedAsks();
      const ask = relayedAsks.get(askId);
      if (!ask || ask.slug !== slug || ask.visitorSub !== visitor.sub) {
        return res.status(404).json({ error: { code: "ASK_UNKNOWN", message: "no pending ask for this visitor and agent (it may have expired, been answered, or belong to another visitor)" } });
      }
      relayedAsks.delete(askId);
      let state;
      try {
        state = await agentState(slug);
      } catch (e) {
        return res.status(503).json({ error: { code: "DEPLOYMENT_SOURCE_UNAVAILABLE", message: `deployment source unreachable (${String(e?.message || e)})` } });
      }
      if (!state?.exists || state.paused) {
        return res.status(404).json({ error: { code: "ASK_UNKNOWN", message: "the agent behind this ask is no longer serving" } });
      }
      try {
        const base = config.agentUrlFor(state.agentPath);
        const url = /\/$/.test(base) ? `${base}ask-answer` : `${base}/ask-answer`;
        const upstream = await upstreamFetch(url, {
          method: "POST",
          headers: { ...forwardHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(cancelled ? { askId, cancelled: true } : { askId, answers: body.answers }),
        });
        const doc = await upstream.json().catch(() => null);
        if (!upstream.ok || !doc || typeof doc !== "object" || typeof doc.accepted !== "boolean") {
          return res.status(502).json({ error: { code: "UPSTREAM_FAILED", message: `agent route refused the answer (${upstream.status})` } });
        }
        note("ask_answered", slug, { ask_id: askId, cancelled, channel: "chat", caller: visitor.email || visitor.sub });
        return res.status(200).json(doc);
      } catch (e) {
        return res.status(502).json({ error: { code: "UPSTREAM_FAILED", message: `agent route refused the answer (${String(e?.message || e)})` } });
      }
    });
  }

  return { register, chatable, hostRemaining, subsidyRemainingToday, settlerFor, settleChatRow, subsidyOpen, anonOpenFor, anonRemainingFor, verifyVisitor };
}
