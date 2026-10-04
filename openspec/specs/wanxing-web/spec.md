# wanxing-web Specification

## Purpose

The Wanxing web face at the Wanxing domain: a human-browsable public agent
catalog, the in-site integration one-pager, and the deployer console (fleet
visibility + management actions) behind deployer authentication.

## Requirements

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

### Requirement: The deployer console authenticates deployers (Logto PKCE, ops token fallback)

The console view SHALL offer Logto login as the primary gate — SPA PKCE via the tenant OIDC, code exchanged through the facade proxy (no browser CORS on the token endpoint), ID token verified server-side (JWKS/ES384, issuer/audience/expiry) against a fail-closed email allowlist — with the ops service token retained as a secondary channel. Authenticated views cover the fleet board, per-agent timeline drill-down, and management actions (deployments list with pause/resume, per-agent caller allowlist).

#### Scenario: identity login

- **WHEN** a deployer signs in with an allowlisted Logto identity
- **THEN** the console renders board, timeline, and management surfaces under that identity, and unauthenticated requests to console routes are refused

#### Scenario: ops token fallback

- **WHEN** the ops service token is entered instead
- **THEN** the same surfaces render; a token-less visitor sees only the login view

#### Scenario: timeline drill-down

- **WHEN** an agent is selected with a valid credential
- **THEN** its lifecycle events render newest-first

### Requirement: The public intro view is the default landing

The web face SHALL serve a public, credential-free intro view at the hash root
`#/` as the default landing: a static, Chinese-first product introduction —
value-positioning hero with entry CTAs into the catalog and docs views, three
feature cards (service catalog / A2A calling / metering and billing), a
one-line how-it-works flow, and the caller quick facts. The quick facts SHALL
render the A2A call sample from the same shared component the docs view uses
(single source; the two surfaces cannot drift). The catalog SHALL remain
reachable at `#/catalog` with its tab; the `#/` semantic change from catalog to
intro is deliberate (first-visit orientation first). The intro view SHALL be
fully static — no catalog or fleet live data, no loading or empty states — and
the footer SHALL link the official site's constellation line page
(`/zh/products/constellation`).

#### Scenario: first visit lands on the intro

- **WHEN** a visitor opens the Wanxing domain root without a hash
- **THEN** the intro view renders as the landing with CTAs into the catalog and docs, and no credential is required

#### Scenario: catalog remains one click away

- **WHEN** a visitor on the intro view clicks the catalog tab or the hero CTA
- **THEN** the catalog view renders at `#/catalog` with its existing behavior unchanged

#### Scenario: the A2A sample has a single source

- **WHEN** the docs view and the intro view both render the call sample
- **THEN** both render from the same shared component, so the two surfaces cannot drift

#### Scenario: intro stays static

- **WHEN** the catalog API or fleet data is unreachable or slow
- **THEN** the intro view renders identically, with no loading state and no dependency on any live API
