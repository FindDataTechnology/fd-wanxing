// ── Snapshot cache: stale-while-revalidate for the catalog's joins ──────────
//
// Five readers feed one catalog response (curation / cluster index / cluster
// units / connector declarations / turns7d). Each used to await its upstream
// on TTL expiry, so with sporadic traffic nearly every visitor paid the cold
// cost — packs browse measured 541ms live, and 16 concurrent post-expiry
// reads took 6406ms. This keeps the shape the entry and bookkeeping snapshots
// already use: fresh → return; expired → return the last-known value and
// refresh behind the request; cold → wait for the first load.
//
// A failed refresh keeps the previous value (stale-on-hiccup). A failed FIRST
// load yields `fallback`, so one dead join degrades honestly (no signal)
// instead of failing the whole catalog.
//
// `load(previous)` receives the last value so a reader that merges across
// refreshes (the cluster index carries per-pack details forward) can do so.

export function createSnapshotCache({ load, ttlMs, fallback, now = () => Date.now() }) {
  let snap = null; // { at, value }
  let inflight = null;

  const refresh = () => {
    if (!inflight) {
      inflight = Promise.resolve()
        .then(() => load(snap?.value))
        .then((value) => {
          snap = { at: now(), value };
          inflight = null;
          return value;
        })
        .catch((e) => {
          inflight = null;
          throw e;
        });
    }
    return inflight;
  };

  return {
    async get() {
      if (!snap) {
        try {
          return await refresh();
        } catch {
          return fallback;
        }
      }
      if (now() - snap.at >= ttlMs) void refresh().catch(() => {});
      return snap.value;
    },
    peek() {
      return snap?.value;
    },
  };
}
