# wanxing-facade Specification

> Forked from paas 2026-10-04 (program slice ②, add-facade-extraction),
> carrying the add-wanxing-deployments-cache delta already applied — this
> repo's spec text is the extraction-era truth; paas marks its copy moved at
> cutover.

## Purpose

The external serving front door of the agent platform (ADR-0014): the Wanxing facade authenticates external callers by their own sub2api caller keys, admits them per agent visibility and per-agent allowlists, bounds and deduplicates their traffic, speaks A2A natively at per-agent routes, meters every admitted turn, and settles the caller's key at the boundary. The registry stays internal; internal callers are unaffected.

## Requirements

### Requirement: External callers authenticate with their own sub2api key

The facade SHALL authenticate every external request by the caller's own sub2api API key presented as a bearer credential, validating it through the auth-only liveness probe that exercises the full billing gate (key validity, balance, group, quota) and resolving the caller's identity by the key's holder. Validation results MAY be cached briefly; every admission decision SHALL reflect a probe no older than the configured cache window. The facade SHALL NOT forward, log, or echo the key value anywhere past the request boundary; audit and metering surfaces SHALL carry at most the key's last four characters.

#### Scenario: A valid solvent key is admitted

- **WHEN** a request arrives with a bearer key that passes the liveness probe
- **THEN** the caller is admitted, the caller identity is resolved from the key's holder, and the request proceeds to agent admission

#### Scenario: A dead or insolvent key is refused at the door

- **WHEN** the probe rejects the key (invalid, exhausted consumption window, or insufficient balance)
- **THEN** the request is refused with a structured error naming the billing-gate reason, and no turn starts

#### Scenario: The key never travels past the facade

- **WHEN** the facade forwards an admitted request toward the agent's runtime route
- **THEN** the forwarded request, its logs, and the ledger contain no key material beyond a masked reference

### Requirement: Agent admission follows visibility and per-agent allowlists

The facade SHALL admit an authenticated caller to an agent according to the deployment's visibility: a public agent admits any caller passing the key gate; a private agent admits only callers whose sub2api account is on that agent's caller allowlist, which the deployer manages on the pack deploy surface. A paused or undeployed agent SHALL return its explicit state error rather than a timeout.

#### Scenario: A public agent serves any valid caller

- **WHEN** an authenticated caller invokes a public agent
- **THEN** the request is admitted without any allowlist check

#### Scenario: A private agent serves only allowlisted callers

- **WHEN** an authenticated caller invokes a private agent and the caller's account is not on that agent's allowlist
- **THEN** the request is refused with a not-authorized error naming the agent, and no turn starts

#### Scenario: A paused agent answers with its state

- **WHEN** the target agent is paused
- **THEN** the caller receives an explicit paused error, not a timeout

### Requirement: The facade speaks A2A natively at per-agent routes

The facade SHALL expose each deployed agent at a stable external route derived from the agent's deployment identity, accepting JSON-RPC `message/send` (synchronous final response) and `message/stream` (SSE passthrough) at the agent's base path, serving its AgentCard at the well-known card path without authentication, and listing public agents with card summaries in a public catalog. Route resolution and the catalog SHALL be served from the cached deployment-bookkeeping snapshot rather than a per-request full fetch. The catalog SHALL support `page`/`page_size` pagination; a request without pagination parameters SHALL return the full list (backward compatible). Unsupported A2A methods SHALL return the protocol's method-not-found error. The facade SHALL forward admitted requests to the agent's runtime route over the platform's internal credentials without altering A2A protocol semantics. Unless the caller supplies a `context_id`, the facade SHALL derive a fresh external context per idempotency key.

#### Scenario: Send returns the agent's completed reply

- **WHEN** an admitted caller invokes `message/send` with a text part
- **THEN** the response returns the agent's reply as text parts once the turn completes

#### Scenario: Stream passes deltas through

- **WHEN** an admitted caller invokes `message/stream`
- **THEN** SSE events pass through incrementally and the stream terminates when the turn completes

#### Scenario: Card and catalog are public

- **WHEN** an unauthenticated party fetches an agent's well-known card path or the agent catalog
- **THEN** public agents' cards and summaries are returned without any credential

#### Scenario: Route resolution reads the snapshot

- **WHEN** an external turn arrives for an agent slug
- **THEN** the slug resolves against the cached snapshot in constant time, without a per-request full bookkeeping fetch

#### Scenario: Catalog paginates on request

- **WHEN** the catalog is requested with `page` and `page_size`
- **THEN** the response contains that page of public agents plus a `total` count, and a request without pagination parameters returns the full list

#### Scenario: A caller-supplied context continues

- **WHEN** an admitted caller reuses a `context_id` it previously used
- **THEN** the conversation continues on that context's runtime session, subject to idle reaping

#### Scenario: Unsupported method

- **WHEN** an admitted caller invokes an A2A method the facade does not implement
- **THEN** a JSON-RPC method-not-found error is returned and no turn runs

### Requirement: Idempotency-Key deduplicates turns

The facade SHALL deduplicate `message/send` requests by the `Idempotency-Key` header, scoped per (caller, agent): a repeated key within the retention window returns the recorded first outcome without running another turn, and concurrent duplicates result in exactly one turn.

#### Scenario: A replayed key returns the recorded outcome

- **WHEN** the same (caller, agent, Idempotency-Key) is replayed after the first request completed
- **THEN** the recorded first outcome is returned and no second turn runs

#### Scenario: Concurrent duplicates run one turn

- **WHEN** two requests with the same Idempotency-Key race while the first turn is still running
- **THEN** exactly one turn executes and both callers receive its outcome

### Requirement: External traffic is bounded per caller and agent

The facade SHALL bound in-flight turns to one per (caller, agent): a second concurrent request SHALL be refused with a structured retry-after error, never interleaved into the running turn. The facade SHALL additionally enforce a configurable per-caller rate limit across agents.

#### Scenario: A concurrent second turn is refused with retry-after

- **WHEN** a caller issues a second request to the same agent while its previous turn is still in flight
- **THEN** the request is refused with a retry-after error and the running turn is unaffected

#### Scenario: A burst over the rate limit is throttled

- **WHEN** a caller exceeds the configured request-rate bound
- **THEN** further requests are throttled with a structured rate-limit error

### Requirement: Admitted turns are metered and settled at the boundary

For every admitted external turn the facade SHALL record caller, agent, idempotency key, outcome, and duration in the facade ledger, and on completion SHALL settle the caller's key by duration — rounded up to whole minutes at the platform-configured rate — through an idempotent balance deduction. Settlement failures SHALL retry with backoff; repeated failure or an exhausted balance SHALL suspend the caller, whose next admission is refused until the key passes the billing gate again.

#### Scenario: A completed turn settles exactly once

- **WHEN** an admitted turn completes
- **THEN** the caller's balance is deducted once for the minute-rounded duration at the configured rate, and the ledger records the settlement

#### Scenario: Settlement failure retries then suspends

- **WHEN** the balance deduction fails transiently and keeps failing
- **THEN** the facade retries with backoff and suspends the caller after the configured threshold

#### Scenario: A suspended caller is re-admitted after the gate passes again

- **WHEN** a suspended caller's key later passes the billing gate (balance restored)
- **THEN** the caller's next request is admitted normally

### Requirement: Deployment bookkeeping snapshot serves resolution and change detection

The facade SHALL maintain an in-process cached snapshot of the deployment bookkeeping (the packs internal API), refreshed on a TTL with single-flight merging, indexed by slug for O(1) resolution. When the source is unreachable the last snapshot SHALL be served stale (matching the registry-entry cache's semantics); staleness beyond a hard window (5 minutes) SHALL degrade to the explicit source-unavailable error rather than serving an indefinitely stale catalog. Snapshot refreshes SHALL compute the deployment diff (added/removed/changed) via an exported pure function, so the fleet observer's bookkeeping-change detector (fd-wanxing program slice ③) reuses the same logic by minimal copy until the facade extraction converges it.

#### Scenario: Source hiccup serves stale

- **WHEN** a refresh attempt fails within the hard staleness window
- **THEN** resolution and the catalog continue serving the last snapshot without error

#### Scenario: Hard staleness degrades explicitly

- **WHEN** the snapshot has been unreachable for longer than the hard window
- **THEN** catalog and card routes respond with the explicit source-unavailable error instead of a stale list

#### Scenario: Diff detects bookkeeping changes

- **WHEN** a refresh observes deployments added, removed, or changed versus the previous snapshot
- **THEN** the exported diff function reports exactly those three buckets, and an unchanged refresh reports all three empty

### Requirement: The facade runs as an independent Wanxing-plane deployment unit

The facade SHALL run as its own process/image (no Yizuo-gateway mounting), exposing its public routes at the Wanxing domain and a `/healthz` liveness endpoint. Its configuration SHALL be env-only with the same names as the gateway-mounted era (`SUB2API_BASE_URL`, `SUB2API_ADMIN_KEY`, `AGENT_SERVING_REGISTRY_URL`, `AGENT_SERVING_REGISTRY_TOKEN`, `AGENT_SERVING_BACKEND_TOKEN`, `PACKS_INTERNAL_BASE_URL`, `FLEET_OBSERVER_URL`, `FLEET_OBSERVER_TOKEN`), so deployment values move over mechanically. Sibling-plane access (Qianmian registry and packs internal API, sub2api) SHALL be HTTP-only via those envs. Login-scoped management routes (the caller-allowlist trio) SHALL be absent from this unit — the deployer product surface rebuilds them (slice ⑤); the allowlist store and admission checks remain.

#### Scenario: standalone boot serves the public face

- **WHEN** the facade image starts with its env set and receives an unauthenticated catalog request at its own origin
- **THEN** public agents are listed and `/healthz` answers ok, with no Yizuo gateway in the path

#### Scenario: ops usage view admits the service credential only

- **WHEN** the ops usage endpoint receives a request bearing the fleet service credential (no user session exists in this unit)
- **THEN** it answers; a request without the credential is refused

### Requirement: Console session endpoints proxy token refresh and revocation

The facade SHALL proxy the tenant OIDC token lifecycle for the console's public client: `POST /api/wanxing/v1/console/auth/refresh` accepts `{ refresh_token }`, exchanges it at the tenant token endpoint (`grant_type=refresh_token`), verifies the returned id_token under the same fail-closed gate as login (JWKS/ES384, issuer/audience/expiry, email allowlist), and returns `{ id_token, refresh_token, email }` — rotation-aware: whichever refresh token the tenant issued is the one returned. `POST /api/wanxing/v1/console/auth/revoke` accepts `{ token }` and best-effort revokes it at the tenant revocation endpoint (`/oidc/token/revocation`), responding ok regardless of upstream outcome (RFC 7009 semantics — revocation is cleanup, never a gate). Both endpoints exist only when Logto is configured; otherwise they respond 503.

#### Scenario: refresh rotates and re-verifies

- **WHEN** a valid refresh token is posted to the refresh proxy
- **THEN** the facade verifies the newly issued id_token against the allowlist and returns the new token pair with the caller's email

#### Scenario: refused identity on refresh

- **WHEN** the refreshed id_token fails verification or the allowlist
- **THEN** the refresh proxy responds 403 and returns no tokens

#### Scenario: revoke is best-effort

- **WHEN** a token is posted to the revoke proxy and the tenant is slow or unreachable
- **THEN** the facade still responds ok (the client clears local state regardless)

#### Scenario: unconfigured deployment

- **WHEN** Logto identity is not configured
- **THEN** both endpoints respond 503 and the legacy exchange/config routes stay absent

### Requirement: Fleet reads pass through the facade under the console gate

The browser-facing fleet observation reads — `GET /api/fleet/v1/board` and `GET /api/fleet/v1/agents/:slug/timeline` — SHALL be served by the facade behind the same dual gate as the console management routes (ops service token, or a verified Logto identity with fail-closed email allowlist). Admitted requests SHALL be forwarded to the observer (`FLEET_OBSERVER_URL`) with the observer service credential (`FLEET_OBSERVER_TOKEN`) as bearer, response status and body passed through. The web face's nginx SHALL route `/api/fleet/` to the facade (not the observer). The observer itself SHALL stay credential-only and unchanged — runners posting `/ingest` and ops-consumers reading the observer directly are unaffected.

#### Scenario: identity holder reads the board

- **WHEN** a caller with a verified allowlisted Logto identity requests `/api/fleet/v1/board` through the web face
- **THEN** the facade admits the request, forwards it with the observer service credential, and the board payload renders

#### Scenario: service credential still accepted

- **WHEN** the ops service token is presented to a fleet read
- **THEN** the facade admits and forwards it the same way

#### Scenario: unauthenticated fleet read

- **WHEN** a fleet read arrives with neither a service token nor a verified identity
- **THEN** the facade responds 401 before contacting the observer

#### Scenario: observer unreachable

- **WHEN** an admitted fleet read cannot reach the observer
- **THEN** the facade responds 502 with a diagnostic error, not the observer's credential challenge
