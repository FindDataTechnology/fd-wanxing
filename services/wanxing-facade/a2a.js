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
import { statusFor } from "./core.js";
import { postJsonWithDeadline } from "./lib/postJsonWithDeadline.js";

const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");

/**
 * Attach `task_id` to a JSON-RPC answer WITHOUT rewriting the answer's shape.
 * A result may be a Message object directly (the runner's send shape) or an
 * object carrying `message`; both tolerate an extra top-level key, and an
 * error answer gets it too (a caller whose call failed still needs the id to
 * ask what happened). Anything that is not an object passes through untouched.
 */
function withTaskId(response, taskId) {
  if (!response || typeof response !== "object") return response;
  const r = response.result;
  if (r && typeof r === "object" && !Array.isArray(r)) {
    // An answer that ALREADY carries a task id keeps it: the mailbox branch
    // mints the id the result will actually be filed under, and overwriting it
    // with ours would leave the caller holding an address nothing answers to.
    if (r.task_id) return response;
    return taskId ? { ...response, result: { ...r, task_id: taskId } } : response;
  }
  // No result (an error answer): put the id beside the error so the caller can
  // still address the attempt that failed.
  return taskId ? { ...response, task_id: taskId } : response;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
const EXTERNAL_CONTEXT_PREFIX = "wx:"; // the runner's reap pass keys on this (design D10)

const textOf = (message) => {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  return text || null;
};

// ── Non-text parts (openspec: add-caas-delivery-contract) ───────────────────
//
// A2A used to flatten `parts` to text and drop everything else, so an agent
// could not hand a file, a chart or an asset reference to another agent — the
// one leg of agent↔agent communication with no route at all.
//
// `artifact_ref` is the form that carries an ASSET LEDGER reference (never
// inline bytes; caas-forms.json: asset.inline_bytes === false):
//
//   { kind: "artifact_ref", assetId, mime, downloadUrl?, sha256?, size? }
//
// Unknown kinds are REFUSED with their names, not silently dropped — a message
// that arrives missing the one thing it was sent to deliver is worse than an
// error. Text parts keep flowing exactly as before (byte-identical for callers
// that only send text).
const ARTIFACT_PART = "artifact_ref";
const KNOWN_TEXT_KINDS = new Set(["text"]);

export function artifactPartsOf(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts.filter((p) => p && p.kind === ARTIFACT_PART);
}

/** Validate + normalise incoming parts. Returns {text, artifacts, unknown}. */
export function readParts(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const artifacts = [];
  const unknown = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const kind = p.kind ?? (typeof p.text === "string" ? "text" : "");
    if (KNOWN_TEXT_KINDS.has(kind) || p.type === "text") continue;
    if (kind === ARTIFACT_PART) {
      const assetId = String(p.assetId ?? p.asset_id ?? "").trim();
      if (!assetId) {
        unknown.push({ kind, reason: "artifact_ref requires assetId" });
        continue;
      }
      artifacts.push({
        kind: ARTIFACT_PART,
        assetId,
        mime: String(p.mime ?? "").trim() || "application/octet-stream",
        ...(p.downloadUrl ? { downloadUrl: String(p.downloadUrl) } : {}),
        ...(p.sha256 ? { sha256: String(p.sha256) } : {}),
        ...(Number.isFinite(p.size) ? { size: Number(p.size) } : {}),
      });
      continue;
    }
    unknown.push({ kind: String(kind || "<none>") });
  }
  return { text: textOf(message), artifacts, unknown };
}

/** Compose an A2A result message carrying text plus any artifact refs. */
export function composeParts({ text, artifacts = [] }) {
  const parts = [];
  if (text) parts.push({ kind: "text", text });
  for (const a of artifacts) parts.push({ kind: ARTIFACT_PART, ...a });
  return { role: "agent", parts };
}

const jsonRpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

// A turn that exhausted ITS OWN budget is -32041 ("timed out"), never the generic
// -32032 ("could not talk to the upstream"): callers key on that difference, and
// the nightly inspection lane reads -32032 as "transport fault, retry later".
// TWO paths can see a timeout — runMemberTurn's AbortSignal (member lane) and the
// a2a message/send forward, which runs postJsonWithDeadline's own timer — so the
// decision lives here once instead of being re-derived (and re-forgotten) per
// catch block. 2026-11-15 live: the send route shipped with only the
// "integer-code passthrough" branch, so a turn killed at its 600 s budget was
// recorded as -32032 with an accurate message — right words, wrong code.
// A DOMException's legacy `code` is a small integer (TimeoutError is 23), so the
// name check must win over the passthrough.
export function turnErrorCode(err) {
  const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
  return timedOut ? -32041 : Number.isInteger(err?.code) ? err.code : -32032;
}

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

// The cluster index entry of one pack (add-cluster-catalog-grouping): null
// unless the manifest declares `cluster`. The team is the declaration —
// defaultAgents ∪ optionalAgents — not the pack's agent list; names come
// from the agent list for presentation. Pure: the cluster unit (sibling
// change add-cluster-service-unit) resolves against the same entry shape.
export function clusterEntryOf(pack, detail) {
  const manifest = detail?.manifest;
  const c = manifest?.cluster;
  if (!c || typeof c !== "object") return null;
  const ids = (list) => (Array.isArray(list) ? list.map((v) => String(v)) : []);
  const defaultAgents = ids(c.defaultAgents);
  if (defaultAgents.length === 0) return null;
  const optionalAgents = ids(c.optionalAgents).filter((id) => !defaultAgents.includes(id));
  const names = new Map((Array.isArray(manifest.agents) ? manifest.agents : []).map((a) => [String(a?.id), a?.name ?? String(a?.id)]));
  const policy = c.schedulingPolicy && typeof c.schedulingPolicy === "object" ? c.schedulingPolicy : {};
  return {
    id: String(pack.id),
    version: pack.version,
    name: String(c.name || pack.name || pack.id),
    description: String(c.description ?? ""),
    defaultAgents,
    optionalAgents,
    agentNames: Object.fromEntries([...defaultAgents, ...optionalAgents].map((id) => [id, names.get(id) ?? id])),
    policy: Number.isInteger(policy.maxConcurrentRuns) && policy.maxConcurrentRuns > 0 ? { maxConcurrentRuns: policy.maxConcurrentRuns } : {},
  };
}

export function createA2aFace({
  core,
  resolveDeployment, // async (slug) → { agentPath } | null
  listDeployments,   // async () → [{ slug, agentPath }]
  hardStale = () => false, // enumeration faces 503 when the bookkeeping snapshot is past its hard window
  ensureFresh = async () => {}, // awaited before that guard: a blocking best-effort refresh (fd-prod finding #2 — an idle facade past the hard window must still be able to refresh through the enumeration path)
  snapshotAt = null,  // () → epoch ms of the deployment snapshot, or null (close-wanxing-domain-linkage D2: status_as_of)
  report = null,     // optional ({kind, agent, payload, id?}) → fleet-observer (add-fleet-event-backbone 6.3)
  forwardHeaders,    // () → the platform's internal dual-credential headers
  registryFetch,     // (path, init?) → fetch Response against the registry
  config,            // { agentUrlFor(agentPath) }
  getReapWindow = null, // (caller, slug) → minutes | null (add-caller-preferences)
  onTurnComplete = null, // ({caller, slug, idemKey, outcome, startedAt, endedAt, minutesBilled, traceId}) → void
  chatability = null, // (state) → boolean (add-agent-chat-lane 3.4): catalog and card summaries carry the marker when true; null = never
  settlementPending = null, // () → { count, usd } | null (wanxing-first-visitor 3.1): usage-ledger pending settlements, for the curated public status aggregate only
  upstreamFetch = fetch, // injection seam for tests
  // Curation + activity signals for the catalog (add-catalog-facets):
  // packsBrowseFetch returns the facet packs browse rows ({id, category,
  // featured} among others); usageTurnsByAgent(sinceMs) returns a Map
  // slug → external turns. Both optional — absent or failing degrades to
  // no signal, never blocks the catalog.
  packsBrowseFetch = null,
  // Cluster index (add-cluster-catalog-grouping): packsDetailFetch(id)
  // returns the facet pack detail ({manifest: {cluster?, agents}}); fetched
  // only for browse rows with agentCount > 1. Optional — absent means no
  // grouping, never a failure.
  packsDetailFetch = null,
  usageTurnsByAgent = null,
  // Listed cluster units (add-cluster-service-unit): async () → [{ id, slug,
  // … }] — the marker gains the unit's slug and url when its cluster is a
  // listed unit. Optional; absent markers carry no endpoint.
  clusterUnits = null,
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

  // One browse fetch feeds both the curation join and the cluster index on
  // the entry cache's cadence; a failure throws to the caller, which keeps
  // its own last-known map.
  const browseCache = { at: 0, rows: null };
  const browseRows = async () => {
    if (!packsBrowseFetch) return [];
    if (browseCache.rows && Date.now() - browseCache.at < entryTtlMs) return browseCache.rows;
    const rows = (await packsBrowseFetch()) ?? [];
    browseCache.rows = rows;
    browseCache.at = Date.now();
    return rows;
  };

  // Curation join (add-catalog-facets): the facet packs browse mapped
  // pack-id → {category, featured}, cached on the entry cache's cadence. A
  // browse that fails or omits a pack leaves that entry signal-less (it
  // renders ungrouped) — the catalog never blocks on the curation join.
  const curationCache = { at: 0, map: new Map() };
  const curationMap = async () => {
    if (!packsBrowseFetch) return curationCache.map;
    if (Date.now() - curationCache.at < entryTtlMs) return curationCache.map;
    try {
      const packs = await browseRows();
      const map = new Map();
      for (const p of packs) map.set(p.id, { category: String(p.category ?? ""), featured: p.featured === true });
      curationCache.map = map;
      curationCache.at = Date.now();
    } catch { /* unreachable join degrades to the last-known map */ }
    return curationCache.map;
  };

  // Cluster index (add-cluster-catalog-grouping D1/D2): a pack groups only
  // when its manifest DECLARES `cluster` — the author's declaration is the
  // team signal (a multi-agent pack without one is a bag of roles), the same
  // rule the Yizuo catalog applies. The declaration lives in the detail, so
  // multi-agent browse rows are detailed once per (pack, version); a
  // republish changes the key and re-reads. A failed detail keeps whatever
  // the previous index knew about that pack; a failed browse keeps the whole
  // previous index — the catalog never blocks on this join.
  // ── External-system declarations (surface-connector-requirements-in-wanxing) ─
  //
  // The declaration half of the requirement projection, cached per packId on
  // the entry cache's cadence.
  //
  // ONLY packs the BROWSE row says declare bindings get detailed. Two reasons,
  // both load-bearing: one detail read per deployment would turn the catalog
  // into N packs reads (the cluster index already refuses that for
  // single-agent packs), and the gate must come from the BROWSE face rather
  // than from the deployed wiring — a pack that declares bindings but minted
  // none is exactly the case this projection exists to show, and its registry
  // entry has no connector trace at all.
  const declarationCache = { at: 0, map: new Map() }; // packId -> array | null
  const connectorDeclarations = async (deps) => {
    if (!packsDetailFetch || !packsBrowseFetch) return declarationCache.map;
    if (Date.now() - declarationCache.at < entryTtlMs) return declarationCache.map;
    let browse;
    try {
      browse = await browseRows();
    } catch {
      return declarationCache.map;
    }
    // A pack the listing does NOT mention is NOT "declares nothing": it can be
    // private, or past the listing's page cap (measured 2026-11-20 on prod — 156
    // packs on the shelf, 100 on page 1, and a probe pack on page 2 was silently
    // reported as undeclared). So an absent row falls through to the detail read;
    // only a row that IS listed with a zero count is a positive "declares none".
    const listed = new Map(
      (Array.isArray(browse) ? browse : []).map((row) => [row?.id, Number(row?.connectorBindingCount) > 0]),
    );
    const next = new Map(declarationCache.map);
    let read = false;
    for (const dep of deps) {
      if (dep.packId == null || next.has(dep.packId)) continue;
      if (listed.get(dep.packId) === false) {
        next.set(dep.packId, null);
        read = true;
        continue;
      }
      try {
        const detail = await packsDetailFetch(dep.packId);
        const declared = detail?.manifest?.connector_bindings ?? detail?.connector_bindings;
        next.set(dep.packId, Array.isArray(declared) ? declared : null);
      } catch {
        // Unreachable packs surface: leave the key absent for this round and
        // retry next round rather than caching a false "nothing declared".
        continue;
      }
      read = true;
    }
    if (read) {
      declarationCache.map = next;
      declarationCache.at = Date.now();
    }
    return next;
  };
  const declarationFor = async (dep) =>
    dep?.packId == null ? null : ((await connectorDeclarations([dep])).get(dep.packId) ?? null);

  const clusterCache = { at: 0, map: new Map(), details: new Map() }; // details: `${id}@${version}` → entry | null
  const clusterMap = async () => {
    if (!packsBrowseFetch || !packsDetailFetch) return clusterCache.map;
    if (Date.now() - clusterCache.at < entryTtlMs) return clusterCache.map;
    try {
      const packs = await browseRows();
      const next = new Map();
      const details = new Map();
      for (const p of packs) {
        if (!(Number(p.agentCount) > 1)) continue;
        const key = `${p.id}@${p.version}`;
        let entry = clusterCache.details.get(key);
        if (entry === undefined) {
          try {
            entry = clusterEntryOf(p, await packsDetailFetch(p.id));
          } catch {
            const prev = clusterCache.map.get(p.id);
            if (prev) {
              next.set(p.id, prev);
              details.set(`${prev.id}@${prev.version}`, prev);
            }
            continue;
          }
        }
        details.set(key, entry);
        if (entry) next.set(p.id, entry);
      }
      clusterCache.map = next;
      clusterCache.details = details;
      clusterCache.at = Date.now();
    } catch { /* browse failure keeps the last-known index */ }
    return clusterCache.map;
  };
  // The marker a deployment carries when it is a declared member of an
  // indexed pack: role from the declaration, `members` the declared team
  // size. An agent the declaration does not name is not a member — it
  // carries nothing, so `x / N` on the page stays honest.
  const clusterMarkerFor = (dep, clusters) => {
    const c = dep?.packId != null ? clusters.get(dep.packId) : null;
    if (!c || !dep.agentId) return null;
    const id = String(dep.agentId);
    const role = c.defaultAgents.includes(id) ? "default" : c.optionalAgents.includes(id) ? "optional" : null;
    if (!role) return null;
    return { id: c.id, name: c.name, role, members: c.defaultAgents.length + c.optionalAgents.length };
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
      packId: dep.packId ?? null,
      agentId: dep.agentId ?? null,
      version: dep.version ?? null,
    };
  }

  // ── Provider redaction (redact-agent-card-private-endpoints) ─────────────
  // provider.url rides the registry entry's runtime address, which in
  // production is a tailnet runner URL. The card is a public discovery face:
  // fail closed and drop the url key when the host is not publicly routable
  // (RFC1918 / CGNAT 100.64/10 / loopback / link-local / single-label service
  // names / cluster suffixes) or unparseable. Everything else — organization
  // and the rest, public URLs — passes through verbatim.
  const PRIVATE_HOST_IP =
    /^(?:10\.|127\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
  function isPrivateProviderUrl(u) {
    let host;
    try {
      host = new URL(u).hostname.toLowerCase();
    } catch {
      return true;
    }
    if (!host || host === "::1" || host === "[::1]" || host === "0.0.0.0") return true;
    if (PRIVATE_HOST_IP.test(host)) return true;
    if (!host.includes(".")) return true;
    return /\.(?:svc|local|internal)$|\.cluster\.local$/.test(host);
  }
  function publicProvider(p) {
    if (p == null) return { organization: "paas-pack" };
    if (typeof p !== "object" || p.url == null) return p;
    if (!isPrivateProviderUrl(String(p.url))) return p;
    const { url: _redacted, ...rest } = p;
    return rest;
  }

  // Pillar facts on the public catalog (openspec unify-pillar-surfaces 3.2).
  // Contract-level only: the declared memory axes and the narrowed tool names.
  // Prose never rides here — `memory.guidance` (the charter text), persona,
  // skill and guide bodies stay on the faces that ask for identity. Absent
  // metadata => absent keys: this face must never invent a default
  // ("unknown != zero", the same rule the derivation itself is held to).
  function publicPillarFacts(entry) {
    const md = entry?.metadata;
    if (!md || typeof md !== "object") return {};
    const facts = {};
    if (md.mcpTools && typeof md.mcpTools === "object") facts.toolFace = md.mcpTools;
    if (md.memory && typeof md.memory === "object") {
      const { guidance: _prose, ...axes } = md.memory;
      if (Object.keys(axes).length > 0) facts.memory = axes;
    }
    // Dashboard (design D8): a single-agent face may not fake a console, it may
    // only say whether the PACK declares a team one. Contract level = headline
    // + block ids; `params` / `surfaces` are author choices, not facts a
    // machine face needs (and they are the part most likely to leak intent).
    if (md.console && typeof md.console === "object") {
      const blocks = Array.isArray(md.console.blocks)
        ? md.console.blocks
            .map((b) => (b && typeof b === "object" ? b.block : b))
            .filter((x) => typeof x === "string" && x.length > 0)
        : [];
      const headline = typeof md.console.headline === "string" ? md.console.headline : null;
      if (blocks.length > 0 || headline) {
        facts.console = { ...(headline ? { headline } : {}), blocks };
      }
    }
    // Fleet formation flag (pillar-surfaces D8): a boolean, never the roster.
    // The D8 copy reads three ways — declared console / team-capable pack with
    // no console / pack that is one agent and nothing else — and the third can
    // only be said if the face knows the pack carries no formation.
    if (md.fleet === true) facts.fleet = true;
    return facts;
  }

  // External-system requirements: two different facts from two different places,
  // and they must not be confused.
  //   the DECLARATION is the pack version's `connector_bindings` (what the pack
  //     asks for), read through the packs detail surface;
  //   the WIRING is `entry.metadata.connector_bindings` — paas composes the
  //     registry entry's metadata FROM THE DESCRIPTOR, and the descriptor only
  //     carries bindings the deploy actually minted.
  // So "missing" = declared keys the deployment never minted. Nothing here needs
  // a new paas field, and `optional` must ride along: paas's mintableBindings()
  // filters `!row.optional`, so an optional binding is NEVER minted by design —
  // reporting it as a gap without saying so sends someone to fix something that
  // cannot change.
  function publicConnectorFacts(entry, declaration) {
    const declared = Array.isArray(declaration) ? declaration : null;
    if (!declared || declared.length === 0) return {};
    const declaredKeys = declared
      .map((row) => (row && typeof row === "object" && typeof row.key === "string" ? row.key : ""))
      .filter(Boolean);
    const wired = new Set(
      (Array.isArray(entry?.metadata?.connector_bindings) ? entry.metadata.connector_bindings : [])
        .map((row) => (row && typeof row.key === "string" ? row.key : ""))
        .filter(Boolean),
    );
    const missing = declared
      .map((row) => (row && typeof row === "object" ? row : {}))
      .filter((row) => typeof row.key === "string" && row.key && !wired.has(row.key))
      .map((row) => ({ key: row.key, optional: row.optional === true }));
    return {
      external_systems: {
        declared: declared.length,
        required: declared.filter((row) => !(row && row.optional === true)).length,
        // Counted against the DECLARATION, not the raw minted set: a deployment
        // can carry a binding this version no longer declares, and letting that
        // push `wired` above `declared` makes the two numbers disagree on screen.
        wired: declaredKeys.filter((key) => wired.has(key)).length,
        missing,
      },
    };
  }

  function publicCard(slug, entry, req, declaration = null) {
    return {
      name: entry.name,
      description: entry.description,
      version: entry.version,
      provider: publicProvider(entry.provider),
      capabilities: entry.capabilities ?? { streaming: true },
      skills: entry.skills ?? [],
      tags: entry.tags ?? [],
      // Sample prompts (add-catalog-discovery): ride verbatim when the
      // composed registry card declares them; absent keeps the shape.
      ...(Array.isArray(entry.examples) && entry.examples.length > 0 ? { examples: entry.examples } : {}),
      default_input_modes: entry.default_input_modes ?? ["text"],
      default_output_modes: entry.default_output_modes ?? ["text"],
      preferred_transport: entry.preferred_transport ?? "jsonrpc",
      // Facade identification (paas add-principal-facade): the descriptor's
      // facade block rides the registry entry's metadata — discovery faces
      // present the conversational front door and its billing stance.
      ...(entry?.metadata?.facade ? { facade: true, facade_stance: entry.metadata.facade.stance ?? "hosted" } : {}),
      // External-system requirements: the pack's declaration joined against what
      // this deployment actually minted. Absent when the pack declares nothing —
      // an undeclared pack must not read as "needs zero systems".
      ...publicConnectorFacts(entry, declaration),
      // The card points callers at the facade, never at the internal runtime.
      url: `${req.protocol}://${req.get("host")}/api/wanxing/v1/a2a/${slug}`,
    };
  }

  // ── The send-transport turn core (add-cluster-service-unit 1.3) ────────────
  // finishTurn is the per-request finish the route has always run, lifted to
  // parameters so a cluster member turn (cluster.js) books through the exact
  // same path: slot release, usage row (with the optional composite linkage),
  // the caller's completion callback, settlement and the fleet event.
  const finishTurn = ({ caller, slug, idemKey, startedAt, outcome, clusterTurnId = null }) => {
    core.releaseSlot(caller.userId, slug);
    const row = core.recordUsage({
      caller, slug, idemKey, startedAt, endedAt: Date.now(), outcome,
      ...(clusterTurnId ? { clusterTurnId } : {}),
    });
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
    return row;
  };

  // One message/send flight over the idempotency ledger: the forward (or the
  // caller-supplied exec — the route's mailbox branch), the answer-derived
  // outcome, and the finish/exit semantics by slot ownership. A flight error
  // is RETURNED as the JSON-RPC error response, never thrown — the route and
  // the cluster face render it identically either way.
  const runSendFlight = async ({ caller, slug, state, text, contextId, idemKey, taskId = null, startedAt, rpcId = null, holdsSlot, clusterTurnId = null, exec = null, timeoutMs = null, artifacts = [] }) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: rpcId,
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text }, ...artifacts].filter((p) => p.kind !== "text" || p.text),
          context_id: contextId,
        },
      },
    });
    const forward = async () => {
      const url = config.agentUrlFor(state.agentPath);
      // Carry the task address across the process boundary (a2a-task-handle
      // 4.7): the runner adopts this id instead of minting its own, so one
      // call has ONE address on both sides of the hop.
      const headers = { ...forwardHeaders(), "Content-Type": "application/json", ...(taskId ? { "x-task-id": taskId } : {}) };
      // A turn's answer lands only when the turn ENDS, so this call is
      // minutes long. `fetch` cannot express that: undici's `headersTimeout`
      // default (300 s) fires first and surfaces as a bare
      // `TypeError: fetch failed`, which the catch below can only label
      // -32032 (generic) — measured live 2026-11-14 as five consecutive
      // 300–301 s turns while the same hop answered a cheap probe in 262 ms.
      // So the long path owns its deadline: our own timer, our own budget,
      // and an expiry that reaches the catch as a TimeoutError → -32041.
      // Tests keep injecting `upstreamFetch`, which must stay untouched.
      const injected = upstreamFetch !== fetch;
      const upstream =
        !injected && Number.isFinite(config.turnTimeoutMs) && config.turnTimeoutMs > 0
          ? await postJsonWithDeadline(url, headers, body, config.turnTimeoutMs)
          : await upstreamFetch(url, {
              method: "POST",
              headers,
              body,
              ...(timeoutMs != null ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
            });
      const doc = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        throw Object.assign(new Error(`agent route refused the turn (${upstream.status})`), { code: -32033 });
      }
      return { response: doc ?? { jsonrpc: "2.0", id: rpcId ?? null, error: { code: -32001, message: "agent route returned an unreadable response" } } };
    };
    try {
      const out = await core.idempotentSend({
        callerId: caller.userId,
        slug,
        idemKey,
        taskId,
        exec: exec ?? forward,
      });
      // message/send: replay/join land here without a slot of their own —
      // no usage row, no settle; the flight's owner did (or will) record.
      // The outcome is derived from the ANSWER, not the HTTP status: the
      // A2A transport carries a model-failed turn as HTTP 200 + a JSON-RPC
      // error object, so "upstream.ok" says nothing about the turn —
      // billing those as "ok" charged callers for turns that returned
      // nothing (live incident 2026-10-13, fix-error-turn-billing).
      const row = out.replayed ? null : finishTurn({ caller, slug, idemKey, startedAt, outcome: out.response?.error ? "error" : "ok", clusterTurnId });
      return { replayed: Boolean(out.replayed), response: out.response, error: out.response?.error?.message ?? null, row };
    } catch (e) {
      const row = holdsSlot ? finishTurn({ caller, slug, idemKey, startedAt, outcome: "error", clusterTurnId }) : null;
      // A DOMException's legacy `code` is a small integer (TimeoutError is
      // 23) — the timeout check must win over the "integer code passthrough"
      // branch or a timeout masquerades as a protocol error.
      const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
      return {
        replayed: false,
        response: { jsonrpc: "2.0", id: rpcId ?? null, error: { code: turnErrorCode(e), message: timedOut ? `turn exceeded ${Math.round(timeoutMs / 1000)}s` : String(e?.message || e) } },
        error: String(e?.message || e),
        timedOut,
        row,
      };
    }
  };

  // One member turn of a cluster composite (add-cluster-service-unit):
  // selection and admission are the cluster face's job; this runs the flight
  // — the member's (caller, member) slot, the derived-key idempotency
  // (`<key>--<agentId>`), the forward under the member timeout, and the same
  // finishTurn a direct turn books. Skips surface as {status:"skipped"}.
  const runMemberTurn = async ({ caller, slug, state, text, contextId, idemKey = null, taskId = null, clusterTurnId, timeoutMs = 300_000, rpcId = null }) => {
    if (!core.acquireSlot(caller.userId, slug)) {
      return { status: "skipped", reason: "TURN_IN_FLIGHT" };
    }
    const startedAt = Date.now();
    const out = await runSendFlight({ caller, slug, state, text, contextId, idemKey, taskId, startedAt, rpcId, holdsSlot: true, clusterTurnId, timeoutMs });
    const err = out.response?.error;
    // The runner answers message/send with the Message AS the result
    // ({result:{role,parts,…}}); the A2A spec also allows {result:{message:…}}
    // — read both, the same tolerance the chat lane applies.
    const replyText = err ? null : textOf(out.response?.result?.message ?? out.response?.result);
    return {
      status: err ? "error" : "ok",
      ...(out.timedOut ? { reason: "TIMEOUT" } : err ? { reason: String(err.code ?? "ERROR") } : {}),
      text: replyText,
      error: out.error,
      replayed: out.replayed,
      ...(out.row ? { durationMs: out.row.durationMs, minutesBilled: out.row.minutesBilled } : {}),
    };
  };

  function register(app) {
    // ── Public discovery: no credential by design (spec: card and catalog
    // are public). Private agents are simply absent from both. Both faces
    // hard-degrade on a hard-stale snapshot (design D2.1); the A2A turn
    // path never does.
    // ── Curated public status (wanxing-first-visitor 3.1): three aggregates
    // for the site footer's live strip — catalog size, 7-day external turns,
    // pending settlements. Each aggregate carries a staleness bit and
    // degrades independently (one source down never 500s the payload);
    // the body is curated on purpose — no internals, no per-caller data,
    // no deep-health report (that stays on the cluster-internal /healthz).
    app.get("/api/wanxing/v1/status", async (_req, res) => {
      const agg = (value) => ({ value: value ?? null, stale: value == null });
      let catalog = null;
      let turns7d = null;
      try {
        await ensureFresh().catch(() => {});
        if (hardStale()) throw new Error("snapshot hard-stale");
        const deps = await listDeployments();
        const turns = await turns7dMap().catch(() => null);
        if (Array.isArray(deps)) {
          catalog = 0;
          turns7d = 0;
          for (const dep of deps) {
            const entry = await entryFor(dep.slug, dep);
            if (!entry || entry.visibility === "private") continue;
            catalog += 1;
            turns7d += turns?.get(dep.slug) ?? 0;
          }
        }
      } catch { /* both aggregates fall through stale */ }
      let pending = null;
      try { pending = settlementPending?.() ?? null; } catch { /* degrade independently */ }
      res.set("Cache-Control", "public, max-age=60");
      res.json({
        agents: agg(catalog),
        turns7d: agg(turns7d),
        settlement_pending: agg(pending ? { count: pending.count, usd: pending.usd } : null),
      });
    });

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
      // both cached 60s, both degrading honestly. The cluster index rides the
      // same cadence (add-cluster-catalog-grouping); the unit endpoint names
      // the marker when the cluster is a listed unit (add-cluster-service-unit).
      const [curation, turns, clusters, listed] = await Promise.all([
        curationMap(),
        turns7dMap(),
        clusterMap(),
        clusterUnits ? clusterUnits().catch(() => []) : [],
      ]);
      const listedUnits = new Map((listed ?? []).map((u) => [u.id, u]));
      // One declaration read per distinct pack, hoisted out of the loop.
      const declarations = await connectorDeclarations(deps).catch(() => declarationCache.map);
      // One derivation of the snapshot instant for the whole response, and one
      // read of the hard-stale flag (close-wanxing-domain-linkage D2). Both are
      // per-response facts, not per-entry ones.
      const staleNow = hardStale();
      const snapAt = snapshotAt ? snapshotAt() : null;
      const statusAsOf = Number.isFinite(snapAt) ? new Date(snapAt).toISOString() : null;
      for (const dep of deps) {
        const entry = await entryFor(dep.slug, dep);
        if (!entry || entry.visibility === "private") continue;
        const cur = dep.packId != null ? curation.get(dep.packId) : null;
        // The entry's REAL pause state. This used to be passed as a literal
        // `paused: false` into the chatability gate, so a paused agent was
        // advertised as chatable while /chat/:slug/status (which reads the
        // same flag through agentState) answered "agent_paused" — one fact,
        // two faces, opposite answers.
        const paused = entry?.metadata?.paused === true;
        const turns7d = turns.get(dep.slug) ?? 0;
        const marker = clusterMarkerFor(dep, clusters);
        const unit = marker ? listedUnits.get(marker.id) ?? null : null;
        const cluster = marker
          ? unit
            ? { ...marker, slug: unit.slug, url: `${req.protocol}://${req.get("host")}/api/wanxing/v1/a2a/cluster/${unit.slug}` }
            : marker
          : null;
        out.push({
          slug: dep.slug,
          name: entry.name,
          description: entry.description,
          version: entry.version,
          tags: entry.tags ?? [],
          capabilities: entry.capabilities ?? { streaming: true },
          skills: entry.skills ?? [],
          ...(Array.isArray(entry.examples) && entry.examples.length > 0 ? { examples: entry.examples } : {}),
          // Three pillars (openspec unify-pillar-surfaces 3.2): the catalog is
          // a machine face, so it carries the declaration's contract facts and
          // none of its prose. Only the /agents entry — the per-agent A2A card
          // is a different face and is left to its own task.
          ...publicPillarFacts(entry),
          ...publicConnectorFacts(entry, dep.packId != null ? declarations.get(dep.packId) ?? null : null),
          // Facade identification (paas add-principal-facade), same rule as
          // the card: ride the registry metadata, absent = ordinary agent.
          ...(entry?.metadata?.facade ? { facade: true, facade_stance: entry.metadata.facade.stance ?? "hosted" } : {}),
          ...(chatability?.({ exists: true, slug: dep.slug, visibility: "public", paused, entry })
            ? { chatable: true }
            : {}),
          // Curation + activity (additive fields; unknown keys are ignored
          // by existing JSON consumers). No category = renders ungrouped.
          // Curation here is a LABEL, never an admission rule: an operator
          // whitelist or a curated-only gate on the marketplace faces must not
          // hide a deployed public agent from this catalog.
          ...(cur?.category ? { category: cur.category } : {}),
          ...(cur?.featured ? { featured: true } : {}),
          turns7d,
          // Live instance status (close-wanxing-domain-linkage 2.2): derived
          // only from facts this process already holds. status_as_of names the
          // snapshot the derivation used, so a consumer can distinguish a fresh
          // "idle" from a frozen "unknown".
          status: statusFor({ paused, turns7d, hardStale: staleNow }),
          ...(statusAsOf ? { status_as_of: statusAsOf } : {}),
          // Cluster marker (additive): only declared members of a
          // cluster-declaring pack carry it.
          ...(cluster ? { cluster } : {}),
        });
      }
      // Server-side facets (add-catalog-facets): filtering happens BEFORE
      // pagination; the facets summary counts the UNFILTERED list so chip
      // rows render whole. A bare request (no filter, no facets, no paging)
      // keeps the legacy full-list shape — only the additive entry fields
      // above differ, which JSON consumers ignore.
      const q = req.query ?? {};
      const hasFilter = q.q !== undefined || q.category !== undefined || q.featured !== undefined || q.cluster !== undefined;
      const wantsFacets = q.facets === "1" || q.facets === "true";
      if (q.page === undefined && q.page_size === undefined && !hasFilter && !wantsFacets) {
        return res.json({ agents: out });
      }
      const needle = String(q.q ?? "").trim().toLowerCase();
      let list = out;
      if (q.category !== undefined) list = list.filter((a) => (a.category ?? "") === String(q.category));
      if (q.featured !== undefined && !["", "0", "false"].includes(String(q.featured))) list = list.filter((a) => a.featured === true);
      if (q.cluster !== undefined) list = list.filter((a) => a.cluster?.id === String(q.cluster));
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
                // Distinct clusters over the unfiltered public list.
                clusters: new Set(out.filter((a) => a.cluster).map((a) => a.cluster.id)).size,
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
      const marker = clusterMarkerFor(state, await clusterMap());
      const unit = marker && clusterUnits ? (await clusterUnits().catch(() => [])).find((u) => u.id === marker.id) ?? null : null;
      res.json({
        ...publicCard(req.params.agentSlug, state.entry, req, await declarationFor(state)),
        ...(chatability?.(state) ? { chatable: true } : {}),
        ...(marker
          ? {
              cluster: unit
                ? { ...marker, slug: unit.slug, url: `${req.protocol}://${req.get("host")}/api/wanxing/v1/a2a/cluster/${unit.slug}` }
                : marker,
            }
          : {}),
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
      // Hoisted above the method dispatch: the tasks/* verbs need the agent
      // slug before the message-shape parsing that the send/stream branch does.
      const slug = req.params.agentSlug;

      const { id, method, params } = req.body ?? {};
      if (req.body?.jsonrpc !== "2.0" || typeof method !== "string") {
        return res.status(200).json(jsonRpcError(id, -32600, "Invalid Request"));
      }
      if (method !== "message/send" && method !== "message/stream" && method !== "tasks/get" && method !== "tasks/cancel" && method !== "tasks/resubscribe") {
        return res.status(200).json(jsonRpcError(id, -32601, `Method not found: ${method}`));
      }
      // ── tasks/* (a2a-task-handle): the three verbs on a task address ─────
      //
      // The ledger row IS the address: bound write-once at accept, kept after
      // the idempotency window closes (a call from last month still needs an
      // answer). `unknown` is its own state — a task id this facade never
      // issued is not "failed" and not "yours but gone".
      if (method === "tasks/get" || method === "tasks/cancel" || method === "tasks/resubscribe") {
        const taskId = params?.task_id ?? params?.taskId ?? params?.id ?? null;
        if (!taskId) return res.status(200).json(jsonRpcError(id, -32602, "task_id required"));
        const row = core.taskLookup({ callerId: caller.userId, slug, taskId });
        if (!row) {
          return res.status(200).json({
            jsonrpc: "2.0",
            id: id ?? null,
            result: { task_id: taskId, state: "unknown", note: "this caller has no task with that id for this agent" },
          });
        }
        const describe = (r) => ({
          task_id: r.task_id,
          state: r.state === "done" ? "done" : r.state === "error" ? "error" : r.state === "cancelled" ? "cancelled" : "running",
          opened_at: r.created_at,
          closed_at: r.closed_at ?? null,
          ...(r.state === "done" && r.response ? { result: safeParse(r.response) } : {}),
        });
        if (method === "tasks/get") {
          return res.status(200).json({ jsonrpc: "2.0", id: id ?? null, result: describe(row) });
        }
        if (method === "tasks/cancel") {
          if (row.state !== "running") {
            // Already over: return WHAT it is. Overwriting a terminal state
            // would erase why it ended.
            return res.status(200).json({ jsonrpc: "2.0", id: id ?? null, result: describe(row) });
          }
          // Relay the cancel to the runner that is executing it, then settle
          // the ledger. A relay failure is NOT reported as "cancelled" — the
          // caller is told the cancel did not reach execution.
          const out = await core.taskCancel({
            taskId,
            row,
            relay: async ({ taskId: tid }) => {
              // The forward transport and credentials live on this face; the
              // ledger rule lives in core. A refusal (no cancel lane) comes
              // back as `unsupported` and is NOT reported as cancelled.
              const url = config.agentUrlFor(state.agentPath);
              // Carry the address header too, same as the send path: a runner
              // that keys its cancel by `x-task-id` finds the record even when
              // the JSON body is all it looks at today.
              const body = JSON.stringify({ jsonrpc: "2.0", id: null, method: "tasks/cancel", params: { task_id: tid } });
              const res = await postJsonWithDeadline(url, { ...forwardHeaders(), "Content-Type": "application/json", "x-task-id": tid }, body, 15_000);
              const doc = await res.json().catch(() => null);
              if (doc?.error?.code === -32013) return "unsupported";
              const st = doc?.result?.state ?? null;
              if (st === "cancelled") return "cancelled";
              if (st === "done" || st === "error") return "not-running";
              return "unknown";
            },
          });
          if (out?.stopped === "unsupported") {
            note("refused", slug, { stage: "cancel", code: "CANCEL_UNSUPPORTED", caller: caller.email || caller.userId, task_id: taskId });
            return res.status(200).json(jsonRpcError(id, -32013, "the executing agent reports no cancel lane; the turn was not stopped"));
          }
          note("cancel", slug, { task_id: taskId, stopped: out?.stopped ?? null, caller: caller.email || caller.userId });
          return res.status(200).json({ jsonrpc: "2.0", id: id ?? null, result: describe(core.taskLookup({ callerId: caller.userId, slug, taskId }) ?? row) });
        }
        // tasks/resubscribe: no per-task delta buffer is kept on this face (the
        // runner's buffer is bounded and dies with it — see agent-runner/
        // tasks.js). The honest answer is the terminal/current state plus a
        // note on why there is no delta replay. For a disclosure-gated lane
        // this is not a limitation but a rule: a partial verdict cannot be
        // released, so only the whole message ever leaves.
        const described = describe(row);
        return res.status(200).json({
          jsonrpc: "2.0",
          id: id ?? null,
          result: {
            ...described,
            replay: "terminal-only",
            note: "incremental replay is not provided; the settled result is delivered in full",
          },
        });
      }
      const message = params?.message ?? params;
      const { text, artifacts, unknown } = readParts(message);
      // Unknown part kinds are REFUSED by name: a message that arrives missing
      // the thing it was sent to deliver is worse than an error (caas-delivery).
      if (unknown.length) {
        return res.status(200).json(
          jsonRpcError(id, -32602, `unsupported part kind(s): ${unknown.map((u) => u.kind).join(", ")}`),
        );
      }
      // A message may carry ONLY artifacts — text is no longer mandatory.
      if (!text && artifacts.length === 0) {
        return res.status(200).json(jsonRpcError(id, -32604, "empty message"));
      }

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
      // The fingerprint binds the key to its request body (unify-wanxing-a2a-
      // face 2.1 — paas fix-agent-serving-stability D2): method + params only
      // — the JSON-RPC `id` is transport (a network retry regenerates it) and
      // carries no request identity. contextId is derived below from the same
      // inputs, so the fingerprint and the flight body can never disagree.
      const contextId = contextIdFor(message, idemKey, getReapWindow ? getReapWindow(caller, slug) : null);
      // Task handle (a2a-task-handle 4.2/4.3): the address exists at ACCEPT.
      // Derived from the idempotency key when there is one (so a replay keeps
      // it) and minted otherwise. Bound write-once to the ledger row BEFORE the
      // flight so a `tasks/get` arriving mid-turn finds a real address.
      const taskId = idemKey ? `t-${sha256(`task|${caller.userId}|${slug}|${idemKey}`).slice(0, 24)}` : `t-${sha256(`anon|${caller.userId}|${slug}|${Date.now()}|${Math.random()}`).slice(0, 24)}`;
      // The id is bound by the flight's own `requestStart` (row creation).
      // Binding before that updates zero rows — a silent drop that made a
      // cancel look up a task nobody had recorded.
      const requestHash = idemKey
        ? sha256(JSON.stringify({ method, params: { message: { role: "user", parts: [{ kind: "text", text }, ...artifacts].filter((p) => p.kind !== "text" || p.text) }, context_id: contextId } }))
        : null;
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

      const startedAt = Date.now();
      if (prior !== "done") note("admitted", slug, { caller: caller.email || caller.userId, idem_key: idemKey || "", transport: method });

      // finish = THIS request's turn ended (slot-holder only): ledger row +
      // fire-and-forget settlement (the pending sweep retries, idempotently).
      // exitReadonly = a replay/join leaves without recording anything.
      const finish = (outcome) => finishTurn({ caller, slug, idemKey, startedAt, outcome });
      const exitReadonly = () => {
        if (holdsSlot) core.releaseSlot(caller.userId, slug);
      };

      const rpcBody = (m) => JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: m,
        // Artifact refs ride through to the target unchanged — that is the
        // whole point (add-caas-delivery-contract): an agent-to-agent message
        // can now deliver a produced asset, not just prose about it.
        params: {
          message: {
            role: "user",
            parts: [{ kind: "text", text }, ...artifacts].filter((p) => p.kind !== "text" || p.text),
            context_id: contextId,
          },
        },
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

        // message/send, with replay semantics on the idempotency key — the
        // shared send-transport flight (also what a cluster member turn
        // rides). The route's only custom exec is the mailbox branch; the
        // normal forward is the flight's own.
        const mailboxExec = seatRunnerId && config.mailboxEnqueue
          ? async () => {
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
          : null;
        const out = await runSendFlight({
          caller, slug, state, text, contextId, idemKey, taskId, requestHash, startedAt, rpcId: id, holdsSlot, exec: mailboxExec, artifacts,
          // The public/pack send path used to pass NO budget at all, so the
          // turn died on undici's 300 s default and was reported as -32032.
          // The budget is the turn's own (WANXING_TURN_TIMEOUT_MS).
          timeoutMs: config.turnTimeoutMs ?? null,
        });
        // A replay/join leaves without recording anything of its own.
        if (out.replayed) exitReadonly();
        // The address rides the answer on BOTH the fresh and the replayed
        // paths — a caller must never have to guess the id of the call they
        // just made, and a replay must address the SAME task (spec 4.3).
        res.status(200).json(withTaskId(out.response, taskId));
      } catch (e) {
        // Key reuse is an admission refusal, not a turn outcome (paas
        // fix-agent-serving-stability D2): HTTP 409 like TURN_IN_FLIGHT, no
        // usage row, slot simply released.
        if (e?.code === "IDEMPOTENCY_KEY_REUSE") {
          if (holdsSlot) core.releaseSlot(caller.userId, slug);
          else exitReadonly();
          note("refused", slug, { stage: "idempotency", code: "IDEMPOTENCY_KEY_REUSE", caller: caller.email || caller.userId, idem_key: idemKey || "" });
          return res.status(409).json({ error: { code: "IDEMPOTENCY_KEY_REUSE", message: String(e?.message || e) } });
        }
        if (holdsSlot) finish("error");
        else exitReadonly();
        res.status(200).json(jsonRpcError(id, turnErrorCode(e), String(e?.message || e)));
      }
    });
  }

  return { register, entryFor, agentState, clusterMap, clusterMarkerFor, runMemberTurn };
}
