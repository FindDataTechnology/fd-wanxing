// ── Wanxing facade, chat lane face (add-agent-chat-lane D1/D4/D7) ───────────
//
// The browser conversation surface: logged-in visitors (tenant identity,
// no console allowlist) chat with chatable public agents, billed by the
// allowance waterfall — platform subsidy first, then the host's allowance,
// never the visitor's own money (the own-key overflow bridge rides the
// EXISTING /a2a route with the pasted key, so this module never sees it).
// Admission, slots, idempotency, and forwarding reuse the same kernel as the
// API lane; the differences are the credential class (ID token vs sk- key),
// the tighter chat-only rate bound, and the settler-resolved ledger rows.

import express from "express";
import { createHash, randomBytes } from "node:crypto";

const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");
const oneShotTail = () => randomBytes(8).toString("hex");

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
  chat = {}, // { subsidyEnabled, subsidyDailyMinutes, rpmMax }
  report = null,
  upstreamFetch = fetch,
}) {
  const cfg = {
    subsidyEnabled: chat.subsidyEnabled ?? false,
    subsidyDailyMinutes: chat.subsidyDailyMinutes ?? 10,
    rpmMax: chat.rpmMax ?? 6,
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
    return Math.max(0, cfg.subsidyDailyMinutes - store.chatSubsidyUsed(visitorSub, from, to));
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

  async function verifyVisitor(req) {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!bearer || !logto?.configured) return null;
    try {
      return await logto.verifyIdToken(bearer, { allowlist: false });
    } catch {
      return null;
    }
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
      res.json({
        ...out,
        subsidyRemainingToday: subsidyRemainingToday(visitor.sub),
        hostPoolRemaining: hostRemaining(slug),
      });
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
      if (!chatable(state)) {
        note("refused", slug, { stage: "admission", code: "CHAT_NOT_OPEN", channel: "chat", caller: visitor.email || visitor.sub });
        return res.status(403).json({ error: { code: "CHAT_NOT_OPEN", message: "this agent is not open for conversations (no subsidy and no host allowance)" } });
      }

      if (!checkChatRpm(caller.userId)) {
        note("refused", slug, { stage: "rate", code: "RATE_LIMITED", channel: "chat", caller: visitor.email || visitor.sub });
        return res.status(429).json({ error: { code: "RATE_LIMITED", message: "visitor chat rate limit exceeded" } });
      }

      // Settler resolves BEFORE the slot: an exhausted waterfall must not
      // even occupy the concurrency machinery (and must answer 402 with the
      // own-key bridge hint).
      const settler = settlerFor(slug, visitor.sub);
      if (!settler) {
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
      if (prior !== "done") note("admitted", slug, { caller: visitor.email || visitor.sub, idem_key: idemKey || "", transport: method, channel: "chat", settler });

      const finish = (outcome) => {
        core.releaseSlot(caller.userId, slug);
        const row = core.recordUsage({ caller, slug, idemKey, startedAt, endedAt: Date.now(), outcome, channel: "chat", settler, visitorSub: visitor.sub });
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
          const upstream = await upstreamFetch(config.agentUrlFor(state.agentPath), {
            method: "POST",
            headers: { ...forwardHeaders(), "Content-Type": "application/json" },
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
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              const frame = decoder.decode(value, { stream: true });
              res.write(frame);
              if (/event:\s*error/.test(frame)) outcome = "error";
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
  }

  return { register, chatable, hostRemaining, subsidyRemainingToday, settlerFor, settleChatRow, subsidyOpen };
}
