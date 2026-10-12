## ADDED Requirements

### Requirement: Deployers organize packs into collections

The facade SHALL persist collections — `{id, owner, name, description, visibility, entries, timestamps}` — one table, entries a JSON list of `{packId, agentId?, suggestedConfig?}` references (no content copies; the pack stays the atomic supply unit). Console-verified owners SHALL create, rename, describe, toggle visibility, and delete their collections, and SHALL replace the whole entry list in one write (≤20 entries, no duplicate packId+agentId, suggestedConfig limited to `{model?, budgetMinutes?, rhythm?}` with cheap shape guards — the facet remains the validation authority at deploy time). Foreign PRIVATE collections SHALL answer 404 on every face. The collection detail SHALL resolve each entry against the cached pack browse (name, version, curation, in-service state) and the cached serving-agent summary (agent name), degrading honestly when a pack row is absent.

#### Scenario: A deployer curates a private grouping

- **WHEN** a verified deployer creates a collection, adds entries from their packs and the directory, and keeps it private
- **THEN** the collection lists only for its owner, and its entries resolve to pack names, versions, and in-service badges

#### Scenario: Entry writes are whole-list and shape-guarded

- **WHEN** an entry-list write carries a duplicate packId+agentId, a non-object suggestedConfig, or more than 20 entries
- **THEN** the write is refused with a 400 naming the rule, and the stored list is unchanged

#### Scenario: Foreign private collections do not exist

- **WHEN** anyone but the owner requests a private collection on any face
- **THEN** the answer is 404 — probing teaches nothing

### Requirement: A public collection deploys as a bundle on the deployer's key

A public collection SHALL be readable without credential at its share face (`GET /collections/:id`) — entries resolved, no owner email leaked — and deployable by ANY verified console identity through `POST /console/collections/:id/deploy` (the owner may deploy a private one). The deploy SHALL take the deployer's billing key (required) and an optional notify channel, iterate the entries sequentially through the self-service deploy core — each entry riding its agentId as the deploy subset and its suggestedConfig as the deploy-time config — and SHALL report a per-entry verdict: `deployed` (with slug), `skipped-in-service` (an in-service pack never blocks the rest), `refused`, or `error` (the facet's structured refusal passes through verbatim). A collection SHALL NOT carry execution semantics — it is a reference list plus deploy-time suggestions only; nothing schedules, runs, or monitors.

#### Scenario: One-click bundle deploy bills once per deployer

- **WHEN** a deployer submits a billing key for a three-entry public bundle (one own pack, one greenfield foreign pack, one in-service foreign pack)
- **THEN** the first two deploy on the deployer's key with their suggested configs riding the payloads, the third reports skipped-in-service, and the response carries three per-entry verdicts

#### Scenario: suggestedConfig rides the payload and stays advisory

- **WHEN** an entry declares `{budgetMinutes: 10, rhythm: [{"every":"1h"}]}` and the deploy succeeds
- **THEN** the forwarded deploy body carries the budget and rhythm for that agent; the facet's validation is the only gate

#### Scenario: A structured refusal surfaces per entry without aborting the bundle

- **WHEN** one entry's deploy is refused by the facet (e.g. lane rejection)
- **THEN** that entry reports refused with the facet's error text, and the remaining entries still deploy

#### Scenario: The share face serves public collections only

- **WHEN** an anonymous visitor opens a public collection's share URL
- **THEN** the bundle renders with resolved entries; a private collection's URL answers 404
