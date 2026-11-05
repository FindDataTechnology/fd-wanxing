## ADDED Requirements

### Requirement: Outbound calls to borrowed services are time-bounded

The facade's outbound calls to borrowed services — registry serving calls (routes doFetch), packs internal API, sub2api admin client — SHALL each carry a timeout (env-tunable, default 5-10s per dependency); on timeout the call path SHALL degrade through existing structured channels (catalog stale-serve/hard-stale 503, admission structured error, settlement pending retry) rather than hanging; the health probe path is itself bounded and never blocks on a hung dependency.

#### Scenario: Registry hangs mid-turn

- **WHEN** the registry accepts a connection but never responds during an A2A turn
- **THEN** the facade returns a structured upstream-timeout error within the registry timeout window, and the turn is not left dangling

#### Scenario: sub2api hangs at admission

- **WHEN** sub2api is unreachable during key admission
- **THEN** admission fails fast with the existing degraded/unavailable semantics instead of stalling the caller

#### Scenario: Catalog follows existing stale discipline

- **WHEN** packs internal is slow beyond timeout
- **THEN** the catalog serves from snapshot within the fresh/stale windows and hard-stales to 503 as it does today, now with the timeout as backstop

### Requirement: Missing critical env fails fast at boot

`SUB2API_BASE_URL` and `PACKS_INTERNAL_BASE_URL` SHALL have no implicit loopback default: a facade deployment missing either SHALL refuse to boot with an error naming the missing variable (or, for variables explicitly marked optional, boot into a clearly degraded mode that reports the gap on /healthz); silent calls to 127.0.0.1 SHALL be impossible.

#### Scenario: Deploy without packs URL

- **WHEN** a facade container starts without `PACKS_INTERNAL_BASE_URL`
- **THEN** startup fails with a message naming the variable — no request ever reaches a loopback default

#### Scenario: Existing deployments unaffected

- **WHEN** production rolls with its complete env set
- **THEN** behavior is unchanged

### Requirement: Fleet event buffering survives restarts

The facade's fleet-report queue SHALL persist undelivered events (disk spool) so facade restarts or observer outages do not silently drop observations; delivery remains at-least-once with deterministic ids (observer-side dedup unchanged); dropped-overflow SHALL be counted and the count exposed on the board.

#### Scenario: Facade restart with queued events

- **WHEN** the facade is killed with undelivered events buffered and restarts
- **THEN** the spool is reloaded and delivered; the observer's duplicate count (not double-counting) confirms exactly-once semantics on the rollup

#### Scenario: Overflow is honest

- **WHEN** the spool exceeds its cap (observer down for an extended window)
- **THEN** the oldest entries are dropped and the drop counter increments, visible on the board rather than silent

### Requirement: Deployment manifests reference services by DNS names

fd-infra-deploy manifests for the wanxing plane SHALL reference dependencies by Service DNS names (or documented stable mesh names), not cluster IP literals; any exception MUST carry an inline justification comment.

#### Scenario: A service is recreated

- **WHEN** the facet (or facade/observer) Service is recreated and its ClusterIP changes
- **THEN** dependent manifests continue to resolve by DNS with zero edits — the 2026-11-05 loopback/stale-IP incident class cannot recur
