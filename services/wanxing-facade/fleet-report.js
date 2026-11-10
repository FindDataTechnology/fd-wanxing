// ── Facade → fleet-observer reporter (add-fleet-event-backbone 6.3) ─────────
//
// Long-term cross-process reporting (2026-10-04 program revision: facade and
// observer stay independently deployed; this never becomes an in-process
// store write). In-memory queue + timer flush + retry: the
// facade's request path never blocks on observability. Settled rows report
// with the usage row's id as the event id — deterministic, so the pending
// sweep and the inline settle can both report the same row exactly once on
// the observer. Inert without a URL.
//
// Disk spool (wanxing-contract-hardening 3.1): the in-memory queue dies with
// the process, so unconfirmed events are appended to
// `{WANXING_DATA_ROOT}/fleet-spool.jsonl` before they count as accepted.
// The file is the durable backlog of record; the queue is the flush view of
// the same rows. A successful flush compacts the file down to the remaining
// queue (confirmation); startup replays every parseable line — a half-written
// tail line (crash mid-append) is skipped and counted as dropped. Replay is
// idempotent downstream: the observer INSERT-OR-IGNOREs by event id and
// counts the duplicates. Overflow drops the OLDEST row (memory cap; the
// compaction removes it from the file too) and bumps `droppedEvents`, which
// rides the existing runner_stats lane onto the observer board (3.2) — no
// observer-side change.

import { randomBytes } from "node:crypto";
import { openSync, writeSync, closeSync, fsyncSync, readFileSync, renameSync, existsSync } from "node:fs";

const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(now) {
  let ts = now;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ENC[ts % 32] + out;
    ts = Math.floor(ts / 32);
  }
  const rnd = randomBytes(10);
  for (let i = 0; i < 16; i++) {
    const b = rnd[i >> 1];
    out += ENC[i % 2 ? b & 0x0f : b >> 4];
  }
  return out;
}

const QUEUE_CAP = 20_000;

export function createFleetReporter({ url, token, source = "facade", fetchImpl = null, now = Date.now, flushIntervalMs = 5_000, maxBatch = 500, log = null, spoolPath = null, statsEveryMs = 60_000, queueCap = null }) {
  const say = log ?? (() => {});
  const queue = [];
  const QUEUE_LIMIT = queueCap ?? QUEUE_CAP;
  let timer = null;
  let flushing = false;
  let droppedEvents = 0;
  let spoolFd = null;
  let lastStatsAt = 0;

  // ── spool primitives (sync fs: event volume is per-turn, never hot) ────────
  const spoolOpen = () => {
    if (spoolPath && spoolFd == null) spoolFd = openSync(spoolPath, "a");
  };
  // Rewrite the file to exactly the current queue contents (confirmation or
  // drop): tmp+rename so a crash mid-compact leaves the old file intact.
  const spoolCompact = () => {
    if (!spoolPath) return;
    if (spoolFd != null) { closeSync(spoolFd); spoolFd = null; }
    const tmp = `${spoolPath}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      for (const ev of queue) writeSync(fd, JSON.stringify(ev) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, spoolPath);
  };
  // Startup replay: every parseable line rejoins the flush view; a truncated
  // tail (crash mid-append) is skipped and counted — never retried blindly.
  const spoolRehydrate = () => {
    if (!spoolPath || !existsSync(spoolPath)) return;
    let text = "";
    try {
      text = readFileSync(spoolPath, "utf8");
    } catch (e) {
      say(`spool unreadable, starting clean: ${e?.message || e}`);
      return;
    }
    const lines = text.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev && typeof ev.id === "string" && typeof ev.kind === "string") queue.push(ev);
        else throw new Error("shape");
      } catch {
        droppedEvents += 1; // half-written or corrupt line
      }
    }
    spoolCompact(); // also drops the corrupt tail physically
  };

  const report = ({ kind, agent, payload = {}, id = null, runner = null }) => {
    if (!url) return;
    const ev = {
      id: id ?? ulid(now()),
      source,
      agent,
      kind,
      ts: now(),
      payload,
      ...(runner ? { runner } : {}),
    };
    // Durable first, then the flush view — a crash between the two loses the
    // event silently (observability: acceptable), never replays a phantom.
    if (spoolPath) {
      try {
        spoolOpen();
        writeSync(spoolFd, JSON.stringify(ev) + "\n");
      } catch (e) {
        say(`spool append failed: ${e?.message || e}`);
      }
    }
    queue.push(ev);
    let droppedNow = 0;
    while (queue.length > QUEUE_LIMIT) {
      queue.shift();
      droppedNow += 1;
    }
    if (droppedNow) {
      droppedEvents += droppedNow;
      say(`spool overflow: dropped ${droppedNow} oldest (total ${droppedEvents})`);
      spoolCompact();
    }
  };

  // Board stat (3.2): the counters piggyback on flush BODIES (never queued,
  // never spooled) — the observer's runner_stats lane spreads payload
  // verbatim, so a `facade` pseudo-runner surfaces droppedEvents/spoolRows
  // without any observer change. Deterministic per-minute id: replays dedupe.
  const statEvent = () => {
    const t = now();
    if (t - lastStatsAt < statsEveryMs) return null;
    lastStatsAt = t;
    return {
      id: `fstat-${source}-${Math.floor(t / 60_000)}`,
      runner: source,
      agent: source,
      kind: "runner_stats",
      ts: t,
      payload: { droppedEvents, spoolRows: queue.length },
    };
  };

  async function flush() {
    if (!url || flushing || queue.length === 0) return;
    flushing = true;
    try {
      if (spoolFd != null) {
        try { fsyncSync(spoolFd); } catch { /* durability best-effort */ }
      }
      const batch = queue.slice(0, maxBatch);
      const stat = statEvent();
      const body = stat ? [...batch, stat] : batch;
      const res = await (fetchImpl ?? fetch)(`${url.replace(/\/+$/, "")}/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ events: body }),
      });
      if (!res.ok) {
        // Read WHY before dropping the response (wanxing-facade spool backlog,
        // 2026-11-10): the 400 body names the offending event
        // (`{"error":"invalid event: {…}"}`), and this line used to log only the
        // status. That is why 340 events sat in the spool for days with nothing
        // but `flush refused (400) — keeping N` to go on: one unknown `kind`
        // rejects the WHOLE batch, so the queue could never shrink, and the
        // reason was being thrown away one line above the log. Bounded read —
        // an error body is a diagnostic, not a payload.
        let why = "";
        try {
          const text = await res.text();
          why = String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
        } catch { /* body already consumed / unreadable — log the status alone */ }
        say(`flush refused (${res.status})${why ? ` — ${why}` : ""} — keeping ${queue.length}`);
        return;
      }
      queue.splice(0, batch.length);
      spoolCompact(); // confirmation: the file shrinks to the unflushed rest
    } catch (e) {
      say(`flush failed: ${e?.message || e} — keeping ${queue.length}`);
    } finally {
      flushing = false;
    }
  }

  if (spoolPath) spoolRehydrate();

  return {
    report,
    flush,
    stats: () => ({ droppedEvents, spoolRows: queue.length }),
    start() {
      if (!url || timer) return;
      void flush();
      timer = setInterval(() => void flush(), flushIntervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      void flush();
      if (spoolFd != null) { try { fsyncSync(spoolFd); } catch { /* best-effort */ } }
    },
  };
}
