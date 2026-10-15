// ── Wanxing facade, A2A protocol face (add-wanxing-serving-api design D2/D5) ─
//
// The v1 wire protocol of the external front door: native A2A JSON-RPC at
// per-agent routes, the public catalog and cards, forwarded to the agent's
// runtime route through the registry proxy on the platform's internal dual
// credentials (X-Authorization service credential + Authorization backend
// token — both platform-held; the caller's sub2api key never travels past
// this module). Everything auth/limit/idempotency/settlement-shaped is
// delegated to the protocol-agnostic core.

import express from "express";
import { createHash, randomBytes } from "node:crypto";

const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");
const EXTERNAL_CONTEXT_PREFIX = "wx:"; // the runner's reap pass keys on this (design D10)

const textOf = (message) => {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  return text || null;
};

const jsonRpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

// Context derivation: caller-supplied context_id passes through untouched; a
// send without one gets a fresh external context derived from the idempotency
// key (stable across replays — a replayed request resumes the same context),
// a stream without one gets a one-shot context. All derived ids carry the
// external prefix so the runner can reap them. A caller's reap-window
// preference (add-caller-preferences) rides IN the derived id as
// `<minutes>x-` — the runner's reap pass resolves the per-session TTL from
// the identifier itself (encodeReapWindow/parseReapWindow below, mirrored
// runner-side; `x` cannot occur in the hex digest, so the segment is
// unambiguous). No preference → no segment → the runner's platform default.
export function encodeReapWindow(minutes) {
  return Number.isInteger(minutes) && minutes > 0 && minutes <= 9_999_999 ? `${minutes}x` : null;
}

// Accepts a context id ("wx:…") or a runner session name ("srv-wx-…").
// Returns minutes or null (null = the platform default).
export function parseReapWindow(value) {
  const body = String(value ?? "").replace(/^wx:/, "").replace(/^srv-wx-/, "");
  const m = body.match(/^(\d{1,6})x(?:-|$)/);
  return m ? Number(m[1]) : null;
}

export function contextIdFor(message, idemKey, reapMinutes = null) {
  const supplied = message?.context_id ?? message?.contextId ?? null;
  if (supplied) return String(supplied);
  const seg = encodeReapWindow(reapMinutes);
  const prefix = `${EXTERNAL_CONTEXT_PREFIX}${seg ? `${seg}-` : ""}`;
  if (idemKey) return `${prefix}${sha256(idemKey).slice(0, 16)}`;
  return `${prefix}${randomBytes(8).toString("hex")}`;
}

export function createA2aFace({
  core,
  resolveDeployment, // async (slug) → { agentPath } | null
  listDeployments,   // async () → [{ slug, agentPath }]
  hardStale = () => false, // enumeration faces 503 when the bookkeeping snapshot is past its hard window
  ensureFresh = async () => {}, // awaited before that guard: a blocking best-effort refresh (fd-prod finding #2 — an idle facade past the hard window must still be able to refresh through the enumeration path)
  report = null,     // optional ({kind, agent, payload, id?}) → fleet-observer (add-fleet-event-backbone 6.3)
  forwardHeaders,    // () → the platform's internal dual-credential headers
  registryFetch,     // (path, init?) → fetch Response against the registry
  config,            // { agentUrlFor(agentPath) }
  getReapWindow = null, // (caller, slug) → minutes | null (add-caller-preferences)
  onTurnComplete = null, // ({caller, slug, idemKey, outcome, startedAt, endedAt, minutesBilled, traceId}) → void
  chatability = null, // (state) → boolean (add-agent-chat-lane 3.4): catalog and card summaries carry the marker when true; null = never
  upstreamFetch = fetch, // injection seam for tests
  // Curation + activity signals for the catalog (add-catalog-facets):
  // packsBrowseFetch returns the facet packs browse rows ({id, category,
  // featured} among others); usageTurnsByAgent(sinceMs) returns a Map
  // slug → external turns. Both optional — absent or failing degrades to
  // no signal, never blocks the catalog.
  packsBrowseFetch = null,
  usageTurnsByAgent = null,
}) {
  const note = (kind, agent, payload = {}, id = null) => {
    try {
      report?.({ kind, agent, payload, id });
    } catch { /* observability never breaks a turn */ }
  };
  // Registry-entry cache: catalog/visibility on a 60s TTL; the paused flag
  // re-reads when older than 15s so an operator's pause reflects promptly
  // (the runner itself lags up to its poll interval anyway).
  const entryTtlMs = 60_000;
  const pausedTtlMs = 15_000;
  const entryCache = new Map(); // slug → { at, entry }

  // Curation join (add-catalog-facets): the facet packs browse mapped
  // pack-id → {category, featured}, cached on the entry cache's cadence. A
  // browse that fails or omits a pack leaves that entry signal-less (it
  // renders ungrouped) — the catalog never blocks on the curation join.
  const curationCache = { at: 0, map: new Map() };
  const curationMap = async () => {
    if (!packsBrowseFetch) return curationCache.map;
    if (Date.now() - curationCache.at < entryTtlMs) return curationCache.map;
    try {
      const packs = (await packsBrowseFetch()) ?? [];
      const map = new Map();
      for (const p of packs) map.set(p.id, { category: String(p.category ?? ""), featured: p.featured === true });
      curationCache.map = map;
      curationCache.at = Date.now();
    } catch { /* unreachable join degrades to the last-known map */ }
    return curationCache.map;
  };
  // Activity signal: per-slug external turns over the trailing 7 days, both
  // lanes — the facade's own usage ledger read back (M4② 热度口径: featured
  // 策展优先档 + turns7d 真实外部使用；安装数无回流不采用).
  const turnsCache = { at: 0, map: new Map() };
  const turns7dMap = async () => {
    if (!usageTurnsByAgent) return turnsCache.map;
    if (Date.now() - turnsCache.at < entryTtlMs) return turnsCache.map;
    try {
      const map = await usageTurnsByAgent(Date.now() - 7 * 24 * 3600_000);
      turnsCache.map = map instanceof Map ? map : new Map(Object.entries(map ?? {}));
      turnsCache.at = Date.now();
    } catch { /* ledger hiccup degrades to the last-known counts */ }
    return turnsCache.map;
  };

  // The deployment source (packs internal API, add-facet-platform S0) being
  // unreachable is a 503, never a hang and never a silent "no agents": the
  // resolvers throw and the routes translate.
  const sourceUnavailable = (res, note) =>
    res.status(503).json({ error: { code: "DEPLOYMENT_SOURCE_UNAVAILABLE", message: `deployment source unreachable (${note})` } });

  async function entryFor(slug, dep = null) {
    const cached = entryCache.get(slug);
    if (cached && Date.now() - cached.at < entryTtlMs) return cached.entry;
    const d = dep ?? (await resolveDeployment(slug));
    if (!d) return null;
    let entry = null;
    try {
      const r = await registryFetch(`/api/agents${d.agentPath}`);
      if (r.ok) entry = await r.json();
    } catch { /* registry unreachable: fall through to the cached view */ }
    if (!entry) return cached?.entry ?? null;
    entryCache.set(slug, { at: Date.now(), entry });
    return entry;
  }

  async function agentState(slug) {
    const dep = await resolveDeployment(slug);
    if (!dep) return { exists: false, slug };
    let entry = await entryFor(slug, dep);
    const cached = entryCache.get(slug);
    if (entry && (!cached || Date.now() - cached.at >= pausedTtlMs)) {
      // A stale-enough view re-reads once so the paused flag is current; on
      // a registry hiccup the cached verdict stands.
      try {
        const r = await registryFetch(`/api/agents${dep.agentPath}`);
        if (r.ok) {
          entry = await r.json();
          entryCache.set(slug, { at: Date.now(), entry });
        }
      } catch { /* keep the cached view */ }
    }
    if (!entry) return { exists: false, slug };
    return {
      exists: true,
      slug,
      visibility: entry?.visibility === "private" ? "private" : "public",
      paused: entry?.metadata?.paused === true,
      entry,
      agentPath: dep.agentPath,
    };
  }

  function publicCard(slug, entry, req) {
    return {
      name: entry.name,
      description: entry.description,
      version: entry.version,
      provider: entry.provider ?? { organization: "paas-pack" },
      capabilities: entry.capabilities ?? { streaming: true },
      skills: entry.skills ?? [],
      tags: entry.tags ?? [],
      // Sample prompts (add-catalog-discovery): ride verbatim when the
      // composed registry card declares them; absent keeps the shape.
      ...(Array.isArray(entry.examples) && entry.examples.length > 0 ? { examples: entry.examples } : {}),
      default_input_modes: entry.default_input_modes ?? ["text"],
      default_output_modes: entry.default_output_modes ?? ["text"],
      preferred_transport: entry.preferred_transport ?? "jsonrpc",
      // The card points callers at the facade, never at the internal runtime.
      url: `${req.protocol}://${req.get("host")}/api/wanxing/v1/a2a/${slug}`,
    };
  }

  function register(app) {
    // ── Public discovery: no credential by design (spec: card and catalog
    // are public). Private agents are simply absent from both. Both faces
    // hard-degrade on a hard-stale snapshot (design D2.1); the A2A turn
    // path never does.
    app.get("/api/wanxing/v1/agents", async (req, res) => {
      await ensureFresh().catch(() => {});
      if (hardStale()) return sourceUnavailable(res, "snapshot hard-stale");
      const out = [];
      let deps;
      try {
        deps = await listDeployments();
      } catch (e) {
        return sourceUnavailable(res, String(e?.message || e));
      }
      // Signals (add-catalog-facets): curation by pack id, activity by slug —
      // both cached 60s, both degrading honestly.
      const [curation, turns] = await Promise.all([curationMap(), turns7dMap()]);
      for (const dep of deps) {
        const entry = await entryFor(dep.slug, dep);
        if (!entry || entry.visibility === "private") continue;
        const cur = dep.packId != null ? curation.get(dep.packId) : null;
        out.push({
          slug: dep.slug,
          name: entry.name,
          description: entry.description,
          version: entry.version,
          tags: entry.tags ?? [],
          capabilities: entry.capabilities ?? { streaming: true },
          skills: entry.skills ?? [],
          ...(Array.isArray(entry.examples) && entry.examples.length > 0 ? { examples: entry.examples } : {}),
          ...(chatability?.({ exists: true, slug: dep.slug, visibility: "public", paused: false, entry })
            ? { chatable: true }
            : {}),
          // Curation + activity (additive fields; unknown keys are ignored
          // by existing JSON consumers). No category = renders ungrouped.
          ...(cur?.category ? { category: cur.category } : {}),
          ...(cur?.featured ? { featured: true } : {}),
          turns7d: turns.get(dep.slug) ?? 0,
        });
      }
      // Server-side facets (add-catalog-facets): filtering happens BEFORE
      // pagination; the facets summary counts the UNFILTERED list so chip
      // rows render whole. A bare request (no filter, no facets, no paging)
      // keeps the legacy full-list shape — only the additive entry fields
      // above differ, which JSON consumers ignore.
      const q = req.query ?? {};
      const hasFilter = q.q !== undefined || q.category !== undefined || q.featured !== undefined;
      const wantsFacets = q.facets === "1" || q.facets === "true";
      if (q.page === undefined && q.page_size === undefined && !hasFilter && !wantsFacets) {
        return res.json({ agents: out });
      }
      const needle = String(q.q ?? "").trim().toLowerCase();
      let list = out;
      if (q.category !== undefined) list = list.filter((a) => (a.category ?? "") === String(q.category));
      if (q.featured !== undefined && !["", "0", "false"].includes(String(q.featured))) list = list.filter((a) => a.featured === true);
      if (needle) {
        list = list.filter((a) =>
          [a.name, a.description, a.slug, ...(a.tags ?? [])].join(" ").toLowerCase().includes(needle),
        );
      }
      const clamp = (v, def) => {
        const n = Number.parseInt(String(v), 10);
        return Number.isFinite(n) && n > 0 ? n : def;
      };
      const pageSize = Math.min(clamp(q.page_size, 50), 200);
      const page = clamp(q.page, 1);
      res.json({
        agents: list.slice((page - 1) * pageSize, page * pageSize),
        page,
        page_size: pageSize,
        total: list.length,
        ...(wantsFacets
          ? {
              facets: {
                total: out.length,
                featured: out.filter((a) => a.featured === true).length,
                categories: Object.entries(
                  out.reduce((acc, a) => {
                    const c = a.category ?? "";
                    if (c) acc[c] = (acc[c] ?? 0) + 1;
                    return acc;
                  }, {}),
                )
                  .map(([name, count]) => ({ name, count }))
                  .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)),
              },
            }
          : {}),
      });
    });

    app.get("/api/wanxing/v1/a2a/:agentSlug/.well-known/agent-card.json", async (req, res) => {
      await ensureFresh().catch(() => {});
      if (hardStale()) return sourceUnavailable(res, "snapshot hard-stale");
      let state;
      try {
        state = await agentState(req.params.agentSlug);
      } catch (e) {
        return sourceUnavailable(res, String(e?.message || e));
      }
      if (!state.exists || state.visibility === "private") {
        return res.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "no public agent at this route" } });
      }
      res.json({
        ...publicCard(req.params.agentSlug, state.entry, req),
        ...(chatability?.(state) ? { chatable: true } : {}),
      });
    });

    // ── The A2A turn surface. Order is the kernel's admission pipeline:
    // key gate → protocol shape → agent admission → plan → rate → slot.
    app.post("/api/wanxing/v1/a2a/:agentSlug", express.json({ limit: "1mb" }), async (req, res) => {
      const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const auth = await core.authenticate(bearer);
      if (!auth.ok) {
        note("refused", req.params.agentSlug, { stage: "key", code: auth.code });
        return res.status(auth.status).json({ error: { code: auth.code, message: auth.message } });
      }
      const caller = auth.caller;

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

      const slug = req.params.agentSlug;
      let state;
      try {
        state = await agentState(slug);
      } catch (e) {
        note("refused", slug, { stage: "source", code: "DEPLOYMENT_SOURCE_UNAVAILABLE" });
        return sourceUnavailable(res, String(e?.message || e));
      }
      const admitted = core.admit(caller, state);
      if (!admitted.ok) {
        note("refused", slug, { stage: "admission", code: admitted.code, caller: caller.email || caller.userId });
        return res.status(admitted.status).json({ error: { code: admitted.code, message: admitted.message } });
      }

      // Serving-plan solvency (add-serving-plans D3): only callers WITH an
      // active plan are bounded by it; a planless caller passes untouched.
      const planGate = core.checkPlan(caller);
      if (!planGate.ok) {
        note("refused", slug, { stage: "plan", code: planGate.code, caller: caller.email || caller.userId });
        return res.status(planGate.status).json({ error: { code: planGate.code, message: planGate.message } });
      }

      if (!core.checkRpm(caller.userId)) {
        note("refused", slug, { stage: "rate", code: "RATE_LIMITED", caller: caller.email || caller.userId });
        return res.status(429).json({ error: { code: "RATE_LIMITED", message: "caller rate limit exceeded" } });
      }

      const idemKey = (() => {
        const h = req.headers["idempotency-key"];
        return typeof h === "string" && h.trim() ? h.trim().slice(0, 200) : null;
      })();
      // Idempotency triage BEFORE the slot (send only — streams never replay):
      // a finished request replays from the ledger (a read), a running flight
      // is JOINED (the turn is already admitted; concurrent duplicates both
      // receive its outcome), and only a genuinely new turn takes the
      // (caller, agent) concurrency slot. Replays and joins never hold the
      // slot, so they cannot leak it, and they record no usage of their own.
      const prior = method === "message/send" ? core.idempotencyState({ callerId: caller.userId, slug, idemKey }) : "new";
      let holdsSlot = false;
      if (prior === "new") {
        if (!core.acquireSlot(caller.userId, slug)) {
          note("refused", slug, { stage: "slot", code: "TURN_IN_FLIGHT", caller: caller.email || caller.userId });
          res.set("Retry-After", "5");
          return res.status(409).json({ error: { code: "TURN_IN_FLIGHT", message: "a turn for this caller and agent is already running; retry after the hint" } });
        }
        holdsSlot = true;
      }

      const contextId = contextIdFor(message, idemKey, getReapWindow ? getReapWindow(caller, slug) : null);
      const startedAt = Date.now();
      if (prior !== "done") note("admitted", slug, { caller: caller.email || caller.userId, idem_key: idemKey || "", transport: method });

      // finish = THIS request's turn ended (slot-holder only): ledger row +
      // fire-and-forget settlement (the pending sweep retries, idempotently).
      // exitReadonly = a replay/join leaves without recording anything.
      const finish = (outcome) => {
        core.releaseSlot(caller.userId, slug);
        const row = core.recordUsage({ caller, slug, idemKey, startedAt, endedAt: Date.now(), outcome });
        // The caller's turn-completion callback (add-caller-preferences):
        // fire-and-forget BESIDE settlement — notification only, settlement
        // untouched. Traced by the usage-row id (the receiver deduplicates on it).
        if (onTurnComplete) {
          void onTurnComplete({
            caller, slug, idemKey, outcome,
            startedAt, endedAt: row.endedAt, minutesBilled: row.minutesBilled, traceId: row.id,
          });
        }
        // Deterministic event id (the usage row id): inline settle and the
        // pending sweep can both report this row — exactly once on the observer.
        if (row.settlementStatus === "waived") {
          note("settled", slug, { minutes_billed: 0, usd: 0, settlement_status: "waived", outcome }, `facade-${row.id}`);
        } else {
          void core.trySettle(row)
            .then((ok) => note("settled", slug, {
              minutes_billed: row.minutesBilled,
              usd: Number((row.minutesBilled * row.rateUsd).toFixed(4)),
              settlement_status: ok ? "settled" : "pending",
              outcome,
            }, `facade-${row.id}`))
            .catch(() => note("settled", slug, { minutes_billed: row.minutesBilled, usd: Number((row.minutesBilled * row.rateUsd).toFixed(4)), settlement_status: "pending", outcome }, `facade-${row.id}`));
        }
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

      // Desktop-seat targets (add-desktop-fleet-runner ④): the turn is
      // deposited in the seat's mailbox and answered with a queued-ack —
      // the seat polls, runs, and settles the task asynchronously. Streaming
      // is refused for seat targets: the seat is behind NAT and possibly
      // cold-resident; a live SSE pipe is not a thing there.
      const seatRunnerId = config.seatTargetFor ? await config.seatTargetFor(state.agentPath) : null;
      if (seatRunnerId && method === "message/stream") {
        finish("error");
        return res.status(200).json(jsonRpcError(id, -32601, "desktop seat targets accept message/send only (async mailbox)"));
      }

      try {
        if (method === "message/stream") {
          // Raw SSE passthrough: frames flow unmodified; the ledger closes
          // when the upstream stream ends (done or error).
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
              // Decode ONCE — the decoder is stateful across chunks; an error
              // event in the frame flips the turn unbillable.
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

        // message/send, with replay semantics on the idempotency key.
        const out = await core.idempotentSend({
          callerId: caller.userId,
          slug,
          idemKey,
          exec: async () => {
            if (seatRunnerId && config.mailboxEnqueue) {
              const taskId = config.mailboxEnqueue({ runnerId: seatRunnerId, agentPath: state.agentPath, text, callerEmail: caller.email ?? "" });
              return {
                response: {
                  jsonrpc: "2.0",
                  id: id ?? null,
                  result: {
                    message_id: `m-${taskId}`,
                    context_id: contextId,
                    kind: "message",
                    parts: [{ kind: "text", text: `任务已入桌面机位队列（taskId ${taskId}）——机位轮询执行，结果经任务查询端点取回` }],
                    task_id: taskId,
                    async: true,
                  },
                },
              };
            }
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
        // message/send: replay/join land here without a slot of their own —
        // no usage row, no settle; the flight's owner did (or will) record.
        // The outcome is derived from the ANSWER, not the HTTP status: the
        // A2A transport carries a model-failed turn as HTTP 200 + a JSON-RPC
        // error object, so "upstream.ok" says nothing about the turn —
        // billing those as "ok" charged callers for turns that returned
        // nothing (live incident 2026-10-13, fix-error-turn-billing).
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

  return { register, entryFor, agentState };
}
