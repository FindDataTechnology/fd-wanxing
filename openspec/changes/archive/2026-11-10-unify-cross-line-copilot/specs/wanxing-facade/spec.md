# wanxing-facade Specification (delta)

## ADDED Requirements

### Requirement: Line copilot bindings are declared in the Wanxing plane

The facade SHALL store, in its own database, a per-line binding naming which public deployment serves that line as its outward copilot, together with the line's accent and its intended visitor policy. A binding SHALL be written only through the console under the ops credential, and only when the named agent exists in the deployment bookkeeping snapshot and is a public deployment. The deployment bookkeeping of the sibling packs surface SHALL remain read-only to the facade — no binding is ever written into it. Unbinding SHALL be a first-class action and take effect on the next resolution.

A binding records **intent**; it SHALL NOT itself admit any visitor. Visitor admission continues to follow the existing gates (the platform anonymous switch AND the agent's deployer-managed anonymous setting, or a verified tenant identity). The console SHALL surface the difference between a line's intended policy and the effective one, so an unopened gate reads as a visible configuration gap rather than a silent trap.

#### Scenario: Ops binds a line to an existing public deployment

- **WHEN** the ops credential binds line `lex` to a slug present in the deployment bookkeeping snapshot and public
- **THEN** the binding is recorded in the facade's own store and the next resolution for `lex` answers with that agent

#### Scenario: Binding an agent that does not exist is refused

- **WHEN** a binding names a slug absent from the deployment bookkeeping snapshot
- **THEN** the write is refused with a structured error and no binding is recorded

#### Scenario: A binding never reaches the sibling ledger

- **WHEN** a binding is written or removed
- **THEN** no request mutating the packs deployment ledger is issued by the facade

#### Scenario: Unbinding resolves as unbound

- **WHEN** an existing binding is removed
- **THEN** the next resolution for that line answers `unbound` and no agent

### Requirement: A public endpoint resolves a line's outward copilot

The facade SHALL serve a public, credential-free read endpoint resolving a line id to its bound copilot, readable cross-origin (any embedding origin), and SHALL answer with the binding's public projection only: the line, a coarse state, the agent's public identity (slug, name, description), a theme accent, the **effective** anonymous availability, and the lane features. It SHALL NOT expose keys, tokens, quota internals, settlement identity, deployer identity, or the binding's intended-policy fields. An unknown line SHALL answer with an explicit unknown state rather than an error; a bound agent that is paused, non-chatable, or missing from bookkeeping SHALL answer with the corresponding closed state rather than a 404 that a host could mistake for success.

#### Scenario: A bound, serveable line answers ready

- **WHEN** an anonymous host fetches the resolution for a line bound to a public, chatable, unpaused agent
- **THEN** the response carries the ready state, the agent's slug/name/description, the accent, the effective anonymous availability, and the ask feature marker

#### Scenario: An unknown line is answerable, not an error

- **WHEN** a request names a line with no binding
- **THEN** the response carries the unbound state with no agent, and no secret or quota field appears

#### Scenario: A paused or vanished binding resolves closed

- **WHEN** the bound agent is paused, no longer public, no longer chatable, or absent from the bookkeeping snapshot
- **THEN** the resolution answers a closed state naming the reason, and no agent conversation is offered

#### Scenario: The projection carries no internals

- **WHEN** any resolution response is inspected
- **THEN** it contains no caller keys, settlement identity, remaining-quota numbers, or deployer email
