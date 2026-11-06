## MODIFIED Requirements

### Requirement: Idempotency-Key deduplicates turns

The facade SHALL deduplicate `message/send` requests by the `Idempotency-Key` header, scoped per (caller, agent): a repeated key within the retention window returns the recorded first outcome without running another turn, and concurrent duplicates result in exactly one turn. Key reuse SHALL be hardened as in paas fix-agent-serving-stability: a key replayed with a DIFFERENT request body fingerprint SHALL be refused with a structured error (never silently treated as a duplicate), an errored first outcome SHALL be recorded and returned on replay (error turns SHALL NOT re-execute), and the stored record SHALL bind the request fingerprint so body-swaps cannot inherit another turn's result.

#### Scenario: A replayed key returns the recorded outcome

- **WHEN** the same (caller, agent, Idempotency-Key) is replayed after the first request completed
- **THEN** the recorded first outcome is returned and no second turn runs

#### Scenario: Concurrent duplicates run one turn

- **WHEN** two requests with the same Idempotency-Key race while the first turn is still running
- **THEN** exactly one turn executes and both callers receive its outcome

#### Scenario: Key reuse with a different body is refused

- **WHEN** a caller sends the same Idempotency-Key with a request body whose fingerprint differs from the recorded one
- **THEN** the facade refuses the request with a structured key-reuse error and no turn runs

#### Scenario: An errored turn is not re-executed on replay

- **WHEN** the first turn with a key ended in an error and the same (caller, agent, key, body) is replayed
- **THEN** the recorded error outcome is returned as-is and the turn is not executed again

## ADDED Requirements

### Requirement: The facade serves deployment management routes in slug addressing

The facade SHALL expose deployment management routes — caller allowlist list/add/remove and pause/resume — addressed by the deployment slug (the existing console routes ARE the management routes: `/api/wanxing/v1/console/deployments/:slug/...`), gated by the console credential (service token, ownerGate token path) and the deployer console gate (Logto) respectively, carrying the same ownership rules; the ops tool surface (wanxing-ops-mcp) addresses them by slug (design 1.2 conclusion).

#### Scenario: ops-mcp manages a deployment without the paas gateway

- **WHEN** wanxing-ops-mcp calls the management routes with the deployment slug and a valid credential
- **THEN** allowlist and pause/resume operations succeed against the facade directly, with responses in the same shape as the console routes

#### Scenario: Ownership rules carry over

- **WHEN** a caller without ownership or a valid gate attempts a management mutation
- **THEN** the facade refuses with the same error semantics as the console route

### Requirement: The facade is the single public A2A card face

After consumer migration, the wanxing facade SHALL be the only public serving point for agent cards and the catalog (wanxing domain and any platform-domain consumers migrated to it); the paas gateway SHALL NOT mount public wanxing A2A card routes, and `wanxing-ops-mcp` SHALL address the facade via `WANXING_OPS_BASE_URL`. Card redaction semantics SHALL be identical across domains because one implementation serves them.

#### Scenario: Platform-domain consumer migrates

- **WHEN** a consumer that previously read `/api/wanxing/v1/a2a/*` on the platform domain is switched to the wanxing domain
- **THEN** the card/catalog response is equivalent (same fields, same redaction), with no per-domain code divergence

#### Scenario: Twin maintenance ends

- **WHEN** a card-redaction or catalog change is made afterward
- **THEN** it is made in one repository only, and no twin commit on the paas side is required

### Requirement: The health endpoint reports deep dependency checks

The facade `/healthz` SHALL report readiness plus deep checks — sub2api admin self-check, registry reachability, packs internal reachability — with per-dependency status; the deep report SHALL be safe for cluster-internal consumption and MUST NOT expose internal addresses, tokens, or counts beyond status to any public surface (the public status strip uses a separate curated endpoint).

#### Scenario: A borrowed dependency hangs

- **WHEN** sub2api is unreachable and `/healthz` is probed
- **THEN** the response names that dependency degraded within the probe timeout, and the probe itself never hangs

#### Scenario: Public surface stays curated

- **WHEN** the public status endpoint is requested anonymously
- **THEN** it returns only curated aggregates (catalog size, 7-day turns, settlement pending), never the deep report internals
