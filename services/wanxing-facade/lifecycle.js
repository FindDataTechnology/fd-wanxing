// ── Lifecycle write rule (one rule, pinned by a fixture) ────────────────────
//
// unify-wanxing-shared-semantics D4. Pausing and resuming writes ONE field —
// the registry entry's `metadata.paused` — but it is written from two doors:
// this facade's console and 壹座's packs surface. Both read and write the same
// registry entry, so the payload must be identical, not merely equivalent.
//
// The subtle half: RESUMING DELETES THE KEY. Every reader in the system tests
// `metadata.paused === true`, so a lingering `paused: false` is a different
// shape that the next consumer will trip over. That is exactly the kind of
// difference a "harmless refactor" introduces, so it is pinned by
// contracts/lifecycle-write.fixture.json rather than by a comment.
//
// This function is PURE (entry in, payload out). The caller owns the HTTP
// write and its update→register fallback, so the rule is testable without a
// registry.

/**
 * The body to PUT for a pause/resume transition.
 * @param {object|null|undefined} entry the registry entry as read
 * @param {boolean} paused           the target state
 * @returns {object} the entry to write back (shallow-copied; input untouched)
 */
export function pausedEntryFor(entry, paused) {
  const next = { ...(entry ?? {}) };
  next.metadata = { ...(next.metadata ?? {}) };
  if (paused === true) next.metadata.paused = true;
  else delete next.metadata.paused;
  return next;
}
