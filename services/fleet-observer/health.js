// ── Agent health derivation (surface-silent-agent-failures 1.x) ──────────────
//
// A deployed agent can fail every single turn for weeks without anyone
// noticing: the board's `errors` counter is a window sum, so "one occasional
// failure" and "this agent has been dead since October" look identical. This
// module derives a health STATE with a duration, from data that already exists
// (the hourly rollup), so the second case sorts itself to the front.
//
// Discipline baked in here (each was a real bug somewhere else):
//   · silent ≠ healthy ≠ failing. Zero turns means NO INFORMATION.
//   · paused is legal rest, not failure — and it must not train people to
//     ignore the alert.
//   · sustained, not proportional: at low volume one failure is 100%.
//   · unknown (failed, no cause known) is distinct from null (no failure).
//
// Pure module: no I/O, no clock reads beyond what the caller passes in.

export const HEALTH = Object.freeze({
  OK: "ok",
  DEGRADED: "degraded",
  SILENT: "silent",
  PAUSED: "paused",
  FAILING: "failing",
});

// Parse an hour bucket key ("2026-11-10T01:00", UTC) to epoch ms.
export function hourKeyToMs(key) {
  const t = Date.parse(`${key}Z`); // key already ends with ":00"; append "Z" for UTC
  return Number.isFinite(t) ? t : null;
}

const HOUR_MS = 3_600_000;

/**
 * Derive one agent's health from its hourly rollup rows.
 *
 * @param {object}   input
 * @param {Array}    input.rows      rollup rows for THIS agent, any order:
 *                                   { hour, turns, errors, budget_kills }
 * @param {boolean?} input.paused    registry pause flag; null/undefined = unknown
 * @param {string?}  input.cause     cause already classified upstream, or null
 * @param {number}   input.failingMinConsecutive  independent constant
 * @param {number}   input.degradedErrorRate      independent constant
 * @param {number?}  input.now       epoch ms (tests inject; used for `since`)
 * @returns {{health:string, since:number|null, consecutive:number,
 *            consecutiveHours:number, lastErrorKind:string|null,
 *            turns:number, errors:number}}
 */
// ── Declared rhythm (flag-stalled-rhythm-agents D2/D3) ──────────────────────
// An agent that declares a rhythm is supposed to produce turns on its own; an
// agent that declares none only runs on inbound work, so zero turns is normal
// life rather than a signal. The declaration reaches us as the registry's
// `metadata.effective_rhythm`, measured to look like `[{"every":"1h"}]`.
//
// Anything we cannot parse is treated as NO DECLARATION, never as an error and
// never as a guess: this signal earns its keep only by being trustworthy, so it
// under-reports rather than cries wolf.
export function parseRhythmMs(effectiveRhythm) {
  if (!Array.isArray(effectiveRhythm) || effectiveRhythm.length === 0) return null;
  const every = effectiveRhythm[0]?.every;
  if (typeof every !== "string") return null;
  const m = /^(\d{1,4})\s*(m|h|d)$/i.exec(every.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toLowerCase();
  const mul = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mul;
}

export function deriveHealth({
  rows = [],
  paused = null,
  cause = null,
  failingMinConsecutive = 3,
  degradedErrorRate = 0.3,
  now = null,
  // Declared rhythm, already parsed to ms (null = no declaration).
  rhythmMs = null,
  // Window the rows cover, used to derive the implied turn count. Defaults to
  // the row count (rollup rows are hourly buckets).
  windowMs = null,
  // Independent constant: how many missed turns make "did not run" a finding.
  // 3 means "we know it should have run at least three times and it ran zero".
  stallMinExpected = 3,
} = {}) {
  const clean = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      hour: String(r.hour ?? ""),
      turns: Number(r.turns) || 0,
      errors: Number(r.errors) || 0,
      kills: Number(r.budget_kills) || 0,
    }))
    .filter((r) => r.hour)
    .sort((a, b) => (a.hour < b.hour ? -1 : a.hour > b.hour ? 1 : 0));

  const turns = clean.reduce((s, r) => s + r.turns, 0);
  const errors = clean.reduce((s, r) => s + r.errors, 0);
  const kills = clean.reduce((s, r) => s + r.kills, 0);

  const base = { since: null, consecutive: 0, consecutiveHours: 0, turns, errors };

  // No failure anywhere in the window → the cause field is ABSENT, not
  // "unknown". Getting this backwards is how "we don't know" turns into
  // "nothing happened".
  const lastErrorKind = errors === 0 ? null : (cause || (kills > 0 ? "budget" : "unknown"));

  // 1) Paused wins over everything — including a wall of failures.
  if (paused === true) {
    return { ...base, health: HEALTH.PAUSED, lastErrorKind };
  }

  // 2) No turns at all → no information. Not healthy, not failing.
  //    But a declared rhythm turns that "no information" into a finding: an
  //    agent that is supposed to fire on its own and fired never is stalled,
  //    and that is a different thing from "nobody called it".
  if (turns === 0) {
    // Hourly rollup rows: the window is as wide as the rows we were given,
    // unless the caller knows better.
    const spanMs = windowMs ?? clean.length * HOUR_MS;
    const expectedTurns = rhythmMs != null && rhythmMs > 0 ? Math.floor(spanMs / rhythmMs) : null;
    const stalled = expectedTurns != null && expectedTurns >= stallMinExpected;
    return {
      ...base,
      health: HEALTH.SILENT,
      lastErrorKind,
      ...(rhythmMs != null ? { declared_every_ms: rhythmMs } : {}),
      ...(expectedTurns != null ? { expected_turns: expectedTurns } : {}),
      ...(stalled ? { stalled: true } : {}),
    };
  }

  // Leading streak of fully-failed hours, newest-first, counted in TURNS
  // (not hours): a low-traffic agent that failed twice is not "3 hours bad".
  //
  // Two different kinds of empty bucket, and conflating them was a real bug:
  //   · LEADING empty buckets (the newest hours, before this agent's streak
  //     began) are padding — the current hour often has no traffic yet, and
  //     treating that as "recovered" made a 19-day outage flap to degraded
  //     every hour on the hour.
  //   · a GAP after the streak started is genuine absence of evidence for the
  //     failure continuing, so it ends the streak.
  let consecutive = 0;
  let consecutiveHours = 0;
  let sinceKey = null;
  let started = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    const r = clean[i];
    if (r.turns === 0) {
      if (!started) continue; // leading padding: the hour simply has no traffic yet
      break; // gap inside the streak: absence is not failure
    }
    if (r.errors < r.turns) break;
    consecutive += r.turns;
    consecutiveHours += 1;
    sinceKey = r.hour;
    started = true;
  }
  const streak = { consecutive, consecutiveHours, since: hourKeyToMs(sinceKey) };

  if (consecutive > 0 && errors === turns && consecutive >= failingMinConsecutive) {
    return { ...base, ...streak, health: HEALTH.FAILING, lastErrorKind };
  }

  // 3) Mixed outcomes above the ratio threshold. The streak still travels so a
  // panel can say "failing since" the moment it flips, without waiting a pass.
  if (errors > 0 && turns > 0 && errors / turns >= degradedErrorRate) {
    return {
      ...base,
      ...streak,
      since: streak.since ?? hourKeyToMs(clean[clean.length - 1]?.hour),
      health: HEALTH.DEGRADED,
      lastErrorKind,
    };
  }

  return { ...base, ...streak, health: HEALTH.OK, lastErrorKind };
}

/**
 * Derive health for every agent present in `rows`, folding in pause flags and
 * causes the caller resolved. Agents whose pause flag could not be read are
 * returned with `stale: true` and are NOT reported as healthy — a failed read
 * must never read as "fine".
 *
 * @param {Array} rows  rollup rows across agents
 * @param {object} opts { pausedByAgent: Map<string,boolean|null>, causeByAgent: Map<string,string>,
 *                        failingMinConsecutive, degradedErrorRate, now }
 */
export function deriveFleetHealth(rows = [], {
  pausedByAgent = new Map(),
  causeByAgent = new Map(),
  failingMinConsecutive = 3,
  degradedErrorRate = 0.3,
  now = null,
  includeStale = false,
  // flag-stalled-rhythm-agents: declared rhythm per agent (ms) + the miss
  // threshold. Absent map = nobody declares a rhythm (everyone stays "silent").
  rhythmMsByAgent = new Map(),
  windowMs = null,
  stallMinExpected = 3,
} = {}) {
  const byAgent = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const a = String(r.agent ?? "");
    if (!a) continue;
    if (!byAgent.has(a)) byAgent.set(a, []);
    byAgent.get(a).push(r);
  }
  const out = [];
  for (const [agent, agentRows] of byAgent) {
    const paused = pausedByAgent.has(agent) ? pausedByAgent.get(agent) : null;
    const health = deriveHealth({
      rows: agentRows,
      paused,
      cause: causeByAgent.get(agent) ?? null,
      failingMinConsecutive,
      degradedErrorRate,
      now,
      rhythmMs: rhythmMsByAgent.get(agent) ?? null,
      windowMs,
      stallMinExpected,
    });
    // An unreadable pause flag means we could not judge this pass. The entry is
    // SKIPPED by default rather than published with a state — "we could not
    // read it" must never be rendered as "everything is fine".
    if (paused === null && !includeStale) continue;
    out.push({
      agent,
      ...health,
      stale: paused === null, // always present: consumers branch on it, not on a missing key
      ...(paused === null ? { health: null } : {}),
    });
  }
  const rank = { failing: 0, degraded: 1, silent: 2, paused: 3, ok: 4 };
  const rankOf = (h) => (h in rank ? rank[h] : 5); // stale/unjudged sorts last
  out.sort((x, y) => (rankOf(x.health) - rankOf(y.health)) || ((x.since ?? Infinity) - (y.since ?? Infinity)) || x.agent.localeCompare(y.agent));
  return out;
}

export { HOUR_MS };
