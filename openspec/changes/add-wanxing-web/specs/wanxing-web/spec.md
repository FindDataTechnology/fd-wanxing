# wanxing-web Specification Delta

## ADDED Requirements

### Requirement: The public catalog page lists agents for humans

The Wanxing web face SHALL serve a public catalog page (no credential) that lists public agents from the facade's catalog API with pagination and client-side search over the loaded page, each entry showing name, description, version, and tags.

#### Scenario: anonymous browse

- **WHEN** a visitor opens the catalog page
- **THEN** public agents render as cards with pagination controls, and typing in the search box filters the loaded page

#### Scenario: catalog API unreachable degrades visibly

- **WHEN** the facade catalog API fails or is unconfigured
- **THEN** the page shows an explicit error state, never an empty list masquerading as "no agents"

### Requirement: The docs face carries the integration one-pager

The web face SHALL render the caller integration essentials (auth by caller key, idempotency header, per-minute billing, error-code table, message/send example) as an in-site page, so an external integrator can start without leaving the domain.

#### Scenario: integrator onboarding

- **WHEN** a visitor opens the docs page
- **THEN** auth, idempotency, billing, and the error-code table are present

### Requirement: The deployer console v1 is token-gated fleet visibility

The console view SHALL gate on a service token entered by the operator (persisted locally), then render the fleet board (the observer's first-version metric set) and a per-agent lifecycle timeline drill-down. Management actions and external-tenant identity are a later increment.

#### Scenario: token gate

- **WHEN** the console is opened without a token
- **THEN** only the token prompt renders; board and timeline are not requested

#### Scenario: timeline drill-down

- **WHEN** an agent is selected with a valid token
- **THEN** its lifecycle events render newest-first
