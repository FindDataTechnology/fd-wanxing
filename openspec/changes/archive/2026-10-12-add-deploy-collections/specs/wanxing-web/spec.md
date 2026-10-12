## ADDED Requirements

### Requirement: The collections view manages the deployer's collections

The console's collections view (`#/collections`) SHALL list the signed-in deployer's collections with visibility and entry counts, create new ones, and open a detail editor: rename/describe/visibility, a whole-list entry editor fed by both sources (my packs and the directory listing with in-service badges), optional per-entry suggested config (model / budget minutes / rhythm preset or JSON), a share link for public collections, and a bundle-deploy dialog (billing key with panel guidance, optional notify channel) that submits once and renders the per-entry verdicts honestly — skipped-in-service reads as skipped, refusals show the facet's text. The view SHALL degrade explicitly on API failure, never rendering an empty list as "no collections".

#### Scenario: The entry editor feeds from both sources

- **WHEN** the deployer opens the entry editor
- **THEN** their own packs and the directory's deployable packs are offered with names and state badges, and picked entries render as reference rows with optional config inputs

#### Scenario: Bundle deploy reports per entry

- **WHEN** the deployer submits the bundle-deploy dialog
- **THEN** each entry renders its verdict — deployed (slug), skipped-in-service, refused (facet text), or error — and the collection itself is untouched

### Requirement: The bundle share page lets a visitor deploy a public collection

The public bundle page (`#/bundle/:id`) SHALL render a public collection's shared view — name, description, resolved entries with pack names, curation badges, and in-service state — for anonymous visitors read-only. A signed-in visitor SHALL additionally get the bundle-deploy dialog (same semantics as the collections view); an anonymous visitor's deploy affordance SHALL route through login first. A missing or private collection SHALL render an explicit not-found state, never an empty bundle.

#### Scenario: An anonymous visitor browses a shared bundle

- **WHEN** a visitor opens a public collection's share URL without signing in
- **THEN** the bundle renders read-only with a login-prompting deploy affordance

#### Scenario: A signed-in visitor one-click-deploys the bundle

- **WHEN** the signed-in visitor submits the deploy dialog on the share page
- **THEN** the deployment bills on their own key with per-entry verdicts, exactly as in the collections view

#### Scenario: Unknown bundles say so

- **WHEN** the share URL names a nonexistent or private collection
- **THEN** the page renders an explicit not-found state
