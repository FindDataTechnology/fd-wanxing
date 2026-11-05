// ── Wanxing facade kernel (add-wanxing-serving-api design D3/D6–D9) ──────────
//
// The protocol-agnostic core of the external front door (ADR-0014): caller-key
// authentication, per-caller rate bounds, (caller, agent) turn slots,
// Idempotency-Key deduplication, and boundary settlement of the caller's
// sub2api key by duration. It knows nothing about A2A — the protocol faces
// (a2a.js today, other protocols later) only call into it.
//
// Settlement direction (probed live 2026-10-03, scripts/probe-wanxing-settle.mjs):
// negative "add" is rejected by sub2api's validation; `operation: "subtract"`
// with a positive amount is the deduction form. The usage-row id rides the
// Idempotency-Key so a retried deduction lands exactly once.

import { createHash, randomBytes } from "node:crypto";

const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");

export function maskKey(key) {
  const s = String(key || "");
  return s ? `…${s.slice(-4)}` : "";
}

// The external agent slug — the deployment's registry path, normalized the
// same way the runner derives its agent key, lowercased and stable across
// in-place upgrades (path carries pack+agent identity).
export function slugFor(agentPath) {
  return String(agentPath || "").replace(/^\/+/, "").replace(/[^A-Za-z0-9._-]+/g, "-").toLowerCase();
}

export function createWanxingCore({ store, sub2api, resolveDeployment = null, config = {} }) {
  // The share commission knob (ADR-0022 ①): revenue × (1 − commission) is the
  // deployer's share. Valid range is the half-open [0, 1) — anything else
  // falls back to the ADR default with a boot-time warning, never silently.
  const commissionFromEnv = () => {
    const raw = process.env.WANXING_SHARE_COMMISSION;
    if (raw == null || raw === "") return 0.30;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v >= 1) {
      console.warn(`[wanxing] WANXING_SHARE_COMMISSION=${raw} out of range [0,1) — falling back to 0.30`);
      return 0.30;
    }
    return v;
  };
  const cfg = {
    ratePerMin: config.ratePerMin ?? Number(process.env.WANXING_RATE_PER_MIN ?? 0.1),
    rpmMax: config.rpmMax ?? Number(process.env.WANXING_RPM_MAX ?? 30),
    keyCacheTtlMs: config.keyCacheTtlMs ?? 60_000,
    negCacheTtlMs: config.negCacheTtlMs ?? 15_000,
    suspendAfterFailures: config.suspendAfterFailures ?? Number(process.env.WANXING_SUSPEND_AFTER_FAILURES ?? 3),
    idemWindowMs: config.idemWindowMs ?? 86_400_000,
    shareCommission: config.shareCommission ?? commissionFromEnv(),
  };

  // In-memory verdict cache keyed by sha256(key) — the key itself is never a
  // Map key or a stored value (log/audit surfaces only ever see maskKey()).
  const verdicts = new Map();
  const rpmBuckets = new Map(); // userId → { windowStart, count }
  const inflightSlots = new Set(); // `${userId}|${slug}`
  const flights = new Map(); // `${userId}|${slug}|${idemKey}` → promise (single-flight)

  const authError = (status, code, message, extra = {}) => ({ ok: false, status, code, message, ...extra });

  async function authenticate(rawKey) {
    // Fail-closed: without the billing plane the facade has no admission
    // rule (same philosophy as the deploy-time balance gate).
    if (!sub2api || sub2api.degraded()) {
      return authError(503, "WANXING_BILLING_UNAVAILABLE", "the billing plane is not configured on this deployment");
    }
    const key = String(rawKey || "").trim();
    if (!/^sk-/.test(key) || key.length > 256) return authError(401, "INVALID_KEY", "a sub2api caller key (sk-…) is required");

    const digest = sha256(key);
    const cached = verdicts.get(digest);
    if (cached && Date.now() - cached.at < (cached.ok ? cfg.keyCacheTtlMs : cfg.negCacheTtlMs)) {
      return cached.verdict;
    }

    // The liveness probe IS the billing gate: GET /v1/models runs the full
    // balance/group/quota check at zero cost, and returns the gateway's own
    // refusal code when the key is dead or broke.
    const probe = await sub2api.probeKeyLiveness(key);
    if (!probe.ok) {
      const broke = /BALANCE/i.test(String(probe.code || "") + String(probe.message || ""));
      const verdict = authError(broke ? 402 : 401, broke ? "INSUFFICIENT_BALANCE" : (probe.code || "INVALID_KEY"), probe.message || "the caller key was refused by the billing gate");
      verdicts.set(digest, { at: Date.now(), ok: false, verdict });
      return verdict;
    }
    const holder = await sub2api.findUserByKey(key);
    if (!holder || !holder.userId) {
      const verdict = authError(401, "UNRESOLVED_KEY", "the caller key cannot be resolved to a sub2api account");
      verdicts.set(digest, { at: Date.now(), ok: false, verdict });
      return verdict;
    }
    const state = store.callerState(holder.userId);
    if (state?.suspended_reason) {
      return authError(402, "CALLER_SUSPENDED", `suspended: ${state.suspended_reason}`);
    }
    const verdict = { ok: true, caller: { userId: holder.userId, email: holder.email ?? "" } };
    verdicts.set(digest, { at: Date.now(), ok: true, verdict });
    return verdict;
  }

  // Rolling per-caller RPM bound across agents (in-memory: anti-abuse
  // backstop; the financial hard cap lives on the key's sub2api windows).
  function checkRpm(userId) {
    const nowTs = Date.now();
    let b = rpmBuckets.get(userId);
    if (!b || nowTs - b.windowStart >= 60_000) {
      b = { windowStart: nowTs, count: 0 };
      rpmBuckets.set(userId, b);
    }
    b.count += 1;
    return b.count <= cfg.rpmMax;
  }

  // One in-flight turn per (caller, agent): the single-writer discipline at
  // the facade. A second concurrent request is refused with a retry hint,
  // never interleaved into the running turn.
  function acquireSlot(userId, slug) {
    const k = `${userId}|${slug}`;
    if (inflightSlots.has(k)) return false;
    inflightSlots.add(k);
    return true;
  }
  function releaseSlot(userId, slug) {
    inflightSlots.delete(`${userId}|${slug}`);
  }

  // Agent admission: visibility first (public = any solvent key), then the
  // private allowlist; paused answers its state explicitly, never a timeout.
  function admit(caller, agent) {
    if (!agent.exists) return authError(404, "AGENT_NOT_FOUND", "no such agent is deployed on this platform");
    if (agent.paused) return authError(423, "AGENT_PAUSED", "this agent is paused");
    if (agent.visibility === "private" && !store.allowlistHas(agent.slug, caller.userId)) {
      return authError(403, "CALLER_NOT_AUTHORIZED", `caller ${caller.email || caller.userId} is not on this agent's allowlist`);
    }
    return { ok: true };
  }

  // Idempotency for message/send (unify-wanxing-a2a-face 2.1 — paas
  // fix-agent-serving-stability D1/D2 backport):
  //   - replay ONLY successful outcomes, and only when the request body's
  //     fingerprint matches the one recorded with the key — a recording with
  //     no fingerprint (predating fingerprinting) cannot match anything, so
  //     it re-executes once and the backfill binds it from then on;
  //   - a key reused with a different body is refused (IDEMPOTENCY_KEY_REUSE)
  //     — never a silent replay of the old answer (the reset-ticket trap);
  //   - a recorded error is NEVER replayed: the same key re-executes and the
  //     new outcome overwrites the row — retried failures are real retries.
  // Concurrent duplicates join the single in-process flight. The ledger row
  // is written before execution, so a crash mid-turn still leaves `running` —
  // treated as absent after the window, never replayed half-done.
  async function idempotentSend({ callerId, slug, idemKey, requestHash = null, exec }) {
    if (!idemKey) return { replayed: false, ...(await exec()) };
    const existing = store.requestGet(callerId, slug, idemKey);
    const inWindow = existing && Date.now() - existing.created_at < cfg.idemWindowMs;
    if (inWindow && existing.request_hash && requestHash && existing.request_hash !== requestHash) {
      throw Object.assign(
        new Error("this Idempotency-Key is bound to a different request body; mint a new key"),
        { code: "IDEMPOTENCY_KEY_REUSE", status: 409 },
      );
    }
    // Replay a recorded success — EXCEPT the heal case: a recording with no
    // fingerprint meeting a fingerprint-bearing retry cannot be trusted to
    // match (the reset-ticket hole); it re-executes and the backfill binds
    // it. Both-sides-fingerprintless callers keep plain replay semantics.
    if (inWindow && existing.state === "done" && !(existing.request_hash == null && requestHash != null)) {
      return { replayed: true, response: JSON.parse(existing.response) };
    }
    const flightKey = `${callerId}|${slug}|${idemKey}`;
    const running = flights.get(flightKey);
    if (running) {
      await running;
      const row = store.requestGet(callerId, slug, idemKey);
      return { replayed: true, response: row?.response ? JSON.parse(row.response) : null };
    }
    if (!store.requestStart(callerId, slug, idemKey, requestHash)) {
      // Lost an insert race (only possible across processes; keep symmetric).
      await Promise.resolve();
    }
    const flight = (async () => {
      try {
        const out = await exec();
        store.requestFinish(callerId, slug, idemKey, "done", JSON.stringify(out.response ?? out), requestHash);
        return { replayed: false, ...out };
      } catch (e) {
        store.requestFinish(callerId, slug, idemKey, "error", JSON.stringify({ error: { code: e.code ?? -32032, message: String(e?.message || e) } }), requestHash);
        throw e;
      } finally {
        flights.delete(flightKey);
      }
    })();
    flights.set(flightKey, flight);
    return flight;
  }

  // Admission triage for the protocol face: a finished request replays from
  // the ledger (no slot, no RPM — it is a read), a running flight is JOINED
  // (the turn is already admitted; spec: concurrent duplicates both receive
  // its outcome), and only a genuinely new turn goes through rate + slot.
  // An error row — or a done row with no recorded fingerprint (legacy, pre-
  // fingerprinting) — is `new`: its retry is a real turn and pays full
  // admission; the retry's backfill binds the key from then on.
  function idempotencyState({ callerId, slug, idemKey }) {
    if (!idemKey) return "new";
    if (flights.has(`${callerId}|${slug}|${idemKey}`)) return "running";
    const row = store.requestGet(callerId, slug, idemKey);
    if (row && Date.now() - row.created_at < cfg.idemWindowMs) {
      if (row.state === "running") return "running";
      return row.state === "done" && row.request_hash ? "done" : "new";
    }
    return "new";
  }

  // ── Boundary settlement (spec: platform-billing) ─────────────────────────
  // Minutes round UP — a 5-second turn bills one minute unit (the rate table
  // is per started minute). outcome=error rows are recorded but waived: the
  // caller is never charged for a turn that produced nothing.
  function recordUsage({ caller, slug, idemKey, startedAt, endedAt, outcome, channel = null, settler = null, visitorSub = null, visitorTier = null, missionId = null, clusterTurnId = null }) {
    const durationMs = Math.max(0, endedAt - startedAt);
    const billable = outcome === "ok";
    const minutesBilled = billable ? Math.max(1, Math.ceil(durationMs / 60_000)) : 0;
    // Serving-plan election (add-serving-plans D2): an API-lane turn by a
    // caller with an active plan settles against the plan — stamped at record
    // time, the same discipline as the chat lane stamps its settler. Chat rows
    // arrive with their settler already resolved and are never re-elected.
    // Mission dispatch rows (add-mission-definitions D4) arrive settler-stamped
    // ('mission') for the same reason: they never elect the owner's plan.
    let planRef = null;
    if (!channel && !settler) {
      const plan = store.planGet(caller.userId);
      if (plan) {
        settler = "plan";
        planRef = plan.planRef;
      }
    }
    const row = {
      id: `wu_${randomBytes(12).toString("hex")}`,
      callerId: caller.userId,
      callerEmail: caller.email,
      agentSlug: slug,
      idemKey: idemKey || "",
      startedAt,
      endedAt,
      durationMs,
      outcome,
      minutesBilled,
      rateUsd: cfg.ratePerMin,
      settlementStatus: billable ? "pending" : "waived",
      // Chat-lane dimensions (add-agent-chat-lane D3); api rows keep nulls.
      // visitor_tier (add-embed-copilot-lane D2): 'anon' for embed-lane
      // ephemeral visitors, 'tenant' for logged-in ones; null = tenant (the
      // store default covers API-era and tenant rows alike).
      ...(channel ? { channel } : {}),
      ...(settler ? { settler } : {}),
      ...(visitorSub ? { visitorSub } : {}),
      ...(visitorSub && visitorTier ? { visitorTier } : {}),
      planRef,
      ...(missionId ? { missionId } : {}),
      // Cluster-turn linkage (add-cluster-service-unit D4): members of one
      // composite call share the id; the composite itself records no row.
      ...(clusterTurnId ? { clusterTurnId } : {}),
    };
    store.usageInsert(row);
    return row;
  }

  // ── Deployer revenue share (add-deployer-revenue-share, ADR-0022) ─────────
  // Deployer resolution: slug → deployment snapshot's deployedBy email →
  // sub2api user id, with a TTL cache mirroring the subsidy-holder cache's
  // shape. Resolution failure is a pending-earnings condition (the account
  // may exist later), never an admission or settlement failure.
  let deployerCache = null; // Map<email, { at, userId } | { at, miss: true }>
  async function resolveDeployerUser(slug) {
    if (!resolveDeployment) return null;
    let dep;
    try {
      dep = await resolveDeployment(slug);
    } catch {
      return null;
    }
    const email = dep?.deployedBy;
    if (!email) return null;
    const hit = deployerCache?.get(email);
    if (hit && Date.now() - hit.at < 300_000) return hit.miss ? null : { userId: hit.userId, email };
    let out = null;
    try {
      const acct = sub2api && !sub2api.degraded() ? await sub2api.findUserByEmail(email) : null;
      if (acct?.userId != null) out = { userId: Number(acct.userId), email };
    } catch { /* cached as a miss for the window; the sweep retries */ }
    if (!deployerCache) deployerCache = new Map();
    deployerCache.set(email, out ? { at: Date.now(), userId: out.userId } : { at: Date.now(), miss: true });
    return out;
  }

  // Share eligibility (design D1): externally-settled real money only — the
  // API lane's key-balance deduction path (no channel dim, no settler), with
  // billable minutes, a resolvable deployer who is not the caller. Plan,
  // mission, subsidy, host, and own-key turns never share; waived/error rows
  // never share (negative protection's positive face).
  async function creditShare(rowIn) {
    try {
      // Both row shapes arrive here: the in-memory recordUsage row (camelCase,
      // no channel key) and DB-read rows (snake_case, channel='api' default).
      // Normalize once at the door — the API lane is "not chat", which is
      // what eligibility means, and the slug answers both spellings.
      const row = { ...rowIn, agentSlug: rowIn.agentSlug ?? rowIn.agent_slug };
      if (row.channel && row.channel !== "api") return false;
      if (row.settler) return false;
      if (!(row.minutesBilled > 0)) return false;
      const existing = store.earningsGet(row.id);
      if (existing?.status === "settled") return true; // already credited (race/retry)
      const deployer = await resolveDeployerUser(row.agentSlug);
      if (!deployer) return false;
      if (deployer.userId === Number(row.callerId)) return false; // self-call: no share
      const revenue = Number((row.minutesBilled * row.rateUsd).toFixed(4));
      const amount = Number((revenue * (1 - cfg.shareCommission)).toFixed(4));
      if (!(amount > 0)) return false;
      store.earningsInsertOrIgnore({
        usageId: row.id, deployerUserId: deployer.userId, deployerEmail: deployer.email,
        agentSlug: row.agentSlug, revenueUsd: revenue, amountUsd: amount, commission: cfg.shareCommission,
      });
      try {
        await sub2api.adjustBalance({
          userId: deployer.userId,
          amountUsd: amount,
          operation: "add",
          idempotencyKey: `share:${row.id}`,
        });
      } catch (e) {
        // A duplicate refusal means the credit already landed (crash between
        // upstream success and the local mark) — that IS the settled state.
        if (!/duplicate|idempoten/i.test(String(e?.message || ""))) throw e;
      }
      store.earningsMarkSettled(row.id);
      return true;
    } catch (e) {
      // A share is a credit owed to the deployer, never a charge — failures
      // leave the row pending for the sweep and can never suspend anyone.
      console.warn(`[wanxing:share] credit failed for ${row.id}: ${e?.message || e}`);
      return false;
    }
  }

  // Reconciliation (design D3): the epoch is this code's first boot — rows
  // settled after it that meet eligibility but lack their share twin (the
  // crash window between usageMarkSettled and the earnings insert) are
  // backfilled here; history before the epoch is never touched.
  async function sweepEarnings() {
    const epoch = store.metaGet("share_epoch");
    if (epoch == null) return;
    for (const row of store.usageSettledSinceWithoutShare(Number(epoch))) {
      await creditShare({ ...row, callerId: row.caller_id, minutesBilled: row.minutes_billed, rateUsd: row.rate_usd });
    }
    for (const er of store.earningsPending()) {
      const row = store.usageGet(er.usageId);
      if (!row) continue;
      await creditShare({ ...row, callerId: row.caller_id, minutesBilled: row.minutes_billed, rateUsd: row.rate_usd });
    }
  }

  async function trySettle(row) {
    // Plan-backed rows settle locally (add-serving-plans D2): the drawdown IS
    // the ledger row — remaining minutes derive from it, so settlement is just
    // the mark. No external call and no failure ladder; a repeated mark (inline
    // settle + sweep racing) is a no-op UPDATE.
    if (row.settler === "plan") {
      store.usageMarkSettled(row.id);
      return true;
    }
    // Mission dispatch rows (add-mission-definitions D4) settle locally for
    // the same reason one step removed: the planner deployment's own billing
    // key already paid the model call upstream (the runner's lane), so the
    // facade-side row exists for cap accounting and audit only — the mark IS
    // the settlement, and the cap is a dispatch gate, never a money mover.
    if (row.settler === "mission") {
      store.usageMarkSettled(row.id);
      return true;
    }
    const amount = Number((row.minutesBilled * row.rateUsd).toFixed(4));
    try {
      await sub2api.adjustBalance({
        userId: row.callerId,
        amountUsd: amount,
        operation: "subtract",
        idempotencyKey: row.id,
      });
      store.usageMarkSettled(row.id);
      store.clearCaller(row.callerId);
      await creditShare(row); // ADR-0022: same-turn deployer share, best-effort
      return true;
    } catch (e) {
      // A retry whose deduction already landed (crash between the upstream
      // success and the local mark) comes back as a duplicate refusal — that
      // IS the settled state, not a new failure.
      if (/duplicate|idempoten/i.test(String(e?.message || ""))) {
        store.usageMarkSettled(row.id);
        store.clearCaller(row.callerId);
        await creditShare(row); // the original landing credits its share here
        return true;
      }
      const failures = store.recordSettlementFailure(row.callerId, e?.message || "settlement failed");
      if (failures >= cfg.suspendAfterFailures) {
        store.suspendCaller(row.callerId, `settlement failed ${failures}× (${e?.message || e})`);
      }
      return false;
    }
  }

  // Boot/timer sweep: retry everything still pending. The row id's
  // Idempotency-Key makes retries safe — a deduction that already landed is
  // refused upstream as a duplicate, which adjustBalance surfaces as an
  // error; treat idempotent-duplicate replies as settled. Chat-lane pending
  // rows (channel=chat) settle against their settler, not the caller's key:
  // onChatRow owns them (add-agent-chat-lane 3.2); without the hook they
  // stay pending for a later sweep that has one.
  async function settlePending(onChatRow = null) {
    // First boot of the share code stamps the epoch (ADR-0022 D3): rows
    // settled after it are reconciled against the earnings ledger each sweep;
    // rows before it are history and are never backfilled.
    if (store.metaGet("share_epoch") == null) store.metaPut("share_epoch", String(Date.now()));
    for (const raw of store.usagePending()) {
      const row = { ...raw, callerId: raw.caller_id, minutesBilled: raw.minutes_billed, rateUsd: raw.rate_usd };
      try {
        if (row.channel === "chat" && onChatRow) {
          await onChatRow(row);
        } else if (row.channel !== "chat") {
          await trySettle(row);
        }
      } catch { /* logged by the failure counter / chat settle hook */ }
    }
    await sweepEarnings();
  }

  // ── Serving-plan admission + state (add-serving-plans D3) ────────────────
  // Remaining minutes derive from the ledger (cap − plan-settled minutes for
  // the caller) — no counter, so a cap adjustment is effective on the very
  // next admission and there is nothing to unsuspend.
  function planStateFor(callerId) {
    const plan = store.planGet(callerId);
    if (!plan) return null;
    const used = store.planUsed(callerId);
    return { plan, used, remaining: Math.max(0, plan.limitMinutes - used) };
  }

  function checkPlan(caller) {
    const st = planStateFor(caller.userId);
    if (!st) return { ok: true };
    if (st.remaining <= 0) {
      return authError(402, "PLAN_EXHAUSTED", "the caller's serving plan has no minutes left — ask the operator to adjust the plan");
    }
    return { ok: true, plan: { planRef: st.plan.planRef, remainingMinutes: st.remaining } };
  }

  return {
    config: cfg,
    authenticate,
    checkRpm,
    acquireSlot,
    releaseSlot,
    admit,
    idempotentSend,
    idempotencyState,
    recordUsage,
    trySettle,
    settlePending,
    creditShare,
    planStateFor,
    checkPlan,
  };
}
