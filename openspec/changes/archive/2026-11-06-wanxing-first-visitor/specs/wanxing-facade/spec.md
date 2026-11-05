## ADDED Requirements

### Requirement: The public catalog excludes retired and internal acceptance agents

The public catalog SHALL only present agents that are currently deployed and servable; retired deployments and internal acceptance/verification agents (deployment or pack marked non-public / retired in the ledger) SHALL NOT render in the catalog, their cards, or facet counts. Exclusion rides the ledger state — the facade adds no hand-maintained blocklist.

#### Scenario: An acceptance agent is retired

- **WHEN** an acceptance deployment is retired (or its pack made private) in the ledger
- **THEN** it disappears from the catalog, facets counts, and cluster groups on the next snapshot refresh, with no code change

#### Scenario: The catalog never renders iteration codenames

- **WHEN** a visitor browses the public catalog
- **THEN** no entry's name or description carries internal acceptance markers (iteration codes, 验收 labels)

### Requirement: The facade serves a curated public status endpoint

The facade SHALL serve a read-only public status endpoint returning curated aggregates only — catalog size, 7-day external turns, settlement pending count/usd — computed from existing ledgers, with cache headers suitable for a footer strip; it MUST NOT expose internal addresses, tokens, per-caller data, or the deep health report.

#### Scenario: Anonymous status probe

- **WHEN** the status endpoint is requested without credentials
- **THEN** it returns the curated aggregate set with 200 and cache headers, leaking nothing internal

#### Scenario: Ledger partially unavailable

- **WHEN** a source aggregate is temporarily unavailable
- **THEN** that aggregate is reported as stale/null while the rest serve — the endpoint never 500s the whole payload

### Requirement: The facade redacts paused agents from admission consistently

An agent paused or retired mid-window SHALL be refused at admission with the structured not-found/paused error it already uses, so the catalog, chat lane, and A2A lane agree on what is servable at any instant.

#### Scenario: Turn against a retired agent

- **WHEN** a caller sends a chat or A2A turn to an agent retired after its card was cached client-side
- **THEN** admission refuses with the existing paused/not-found structured error and no turn is metered
