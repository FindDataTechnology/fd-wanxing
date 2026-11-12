## MODIFIED Requirements

### Requirement: Registry paths and rollup identities are mapped by one rule

Every component of this repository that derives an agent's public identity (slug) from a registry path — the observer and the facade, including every face the facade mounts — SHALL use ONE shared derivation, and SHALL NOT maintain a second, divergent derivation inside this repository. A path that fails to map SHALL be treated as having no declaration rather than as a distinct agent. The derivation's behavior SHALL additionally be pinned by a published fixture (`contracts/agent-identity.fixture.json`) covering the boundary cases — leading slashes, upper case, underscores, runs of disallowed characters (which collapse per run, not per character), non-ASCII runs, the empty path, and an already-slugged path — so sibling repositories can assert the same behavior without sharing code.

#### Scenario: A registry path maps to the rollup identity

- **WHEN** the registry reports a deployment at a path containing upper case and underscores
- **THEN** the derived slug equals the identity the rollup uses for that agent's turns, so its declared rhythm is applied to the right entry

#### Scenario: Mapping happens in exactly one place

- **WHEN** any part of the observer needs an agent's slug from its registry path
- **THEN** it uses that single shared derivation

#### Scenario: The facade derives identity from the same function

- **WHEN** a component of the facade (public catalog, self-service deploy path, or any other face) needs an agent's slug from a registry path
- **THEN** it uses the same shared derivation as the observer, not a local re-implementation

#### Scenario: The fixture pins the boundary behavior

- **WHEN** the shared derivation's output for any fixture case differs from the published expectation
- **THEN** the test fails and names the offending input path

#### Scenario: A sibling implementation diverges

- **WHEN** a sibling repository's implementation disagrees with the published fixture
- **THEN** that repository's own fixture test fails, without either repository importing the other's code
