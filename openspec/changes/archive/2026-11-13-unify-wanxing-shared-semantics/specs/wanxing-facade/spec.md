## ADDED Requirements

### Requirement: Outbound dependency addressing resolves through one declared table

Every outbound read of a borrowed dependency's address or credential SHALL resolve through one declared table and one resolver, keyed by upstream and component. The table SHALL name, for each upstream, the canonical variable, the accepted aliases, the default, and whether it is required. Two code paths in the same component that address the same upstream SHALL accept exactly the same alias set with the same precedence — a narrower alias set on one path is a defect, because it makes a configured deployment work on one face and fail on another. A new upstream SHALL be added to the table rather than read inline at its call site. Resolution SHALL NOT fabricate a value: an unconfigured upstream resolves to absent, leaving the existing explicit degradation (a 503, or a hidden affordance) unchanged.

#### Scenario: Both faces of one upstream accept the same aliases

- **WHEN** a deployment configures only the legacy alias of the memory upstream and both the chat lane and the console memory face address it
- **THEN** both resolve it, and neither reports unconfigured

#### Scenario: Different components may name one upstream differently

- **WHEN** the facade and the observer address the registry upstream through their own variable families
- **THEN** both resolve through the table, and the table records both families as the same upstream

#### Scenario: An unconfigured upstream stays explicitly absent

- **WHEN** an upstream has no value configured under any of its declared names
- **THEN** it resolves to absent and the dependent face keeps its explicit degradation, never a fabricated default or a silent empty success

#### Scenario: Inline addressing is refused

- **WHEN** a new outbound dependency read reads its variable directly at the call site instead of through the table
- **THEN** the change is refused in review, because the dependency becomes undiscoverable

### Requirement: Lifecycle state has exactly one write rule

Pausing and resuming a deployment SHALL be written by one rule whose payload is pinned by a published fixture (`contracts/lifecycle-write.fixture.json`): read the registry entry, set `metadata.paused` when pausing, and REMOVE the key when resuming — never write `paused: false`. Every door that pauses or resumes (this facade's console face and the platform's deployments face) SHALL produce the same registry result for the same agent, and the two implementations SHALL each be validated against the same fixture rather than against a shared code dependency.

#### Scenario: Resuming removes the key rather than writing false

- **WHEN** a resumed deployment's registry entry is read back
- **THEN** it carries no `metadata.paused` key, exactly as the fixture declares

#### Scenario: Two doors, one result

- **WHEN** the same deployment is paused through the facade's console face and, separately, through the platform's deployments face
- **THEN** both leave the registry in the same state, and any divergence fails the fixture test on the side that drifted

#### Scenario: The upsert fallback is part of the rule

- **WHEN** the registry's update route refuses the write and the create-side register route has to carry it
- **THEN** the same payload semantics apply, and a failure of both is reported as a registry write failure rather than a silent success
