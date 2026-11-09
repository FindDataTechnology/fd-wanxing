# fleet-observability Specification (delta)

## ADDED Requirements

### Requirement: A silent agent declares whether it was expected to be silent

A health entry reporting `silent` (no turns in the window) SHALL additionally report the agent's
declared rhythm interval, the number of turns that interval implies for the window, and whether the
agent is stalled — stalled meaning its declared rhythm implies at least a configured minimum number
of turns while the window observed none. The state itself SHALL remain `silent`: the extra fields
annotate the observation, they do not replace it.

An agent whose entry carries no recognisable rhythm declaration SHALL report no implied turn count
and SHALL NOT be marked stalled — zero turns is that agent's normal life. A paused agent SHALL
remain `paused` and SHALL NOT be evaluated for staleness. When the rhythm declaration cannot be
read because its source is unavailable, the entry SHALL degrade to "no declared rhythm" rather than
guessing, and SHALL NOT be marked stalled.

#### Scenario: A rhythmic agent with zero turns is stalled

- **WHEN** an agent declares an hourly rhythm and its window contains zero turns while the implied count reaches the configured minimum
- **THEN** the entry stays `silent` and additionally reports the declared interval, the implied turn count, and `stalled` true

#### Scenario: A non-rhythmic agent is silent, not stalled

- **WHEN** an agent has no recognisable rhythm declaration and its window contains zero turns
- **THEN** the entry reports `silent` with no implied count and is not marked stalled

#### Scenario: Too few implied turns is not evidence

- **WHEN** an agent's declared rhythm implies fewer turns for the window than the configured minimum
- **THEN** it is not marked stalled even though it observed none

#### Scenario: A paused agent is never stalled

- **WHEN** an agent is paused and its window contains zero turns
- **THEN** the entry reports `paused` and carries no staleness verdict

#### Scenario: An unreadable declaration degrades to no declaration

- **WHEN** the rhythm declaration is unavailable or in a shape the observer cannot parse
- **THEN** the entry reports no implied count and is not marked stalled, and the rest of the health entry is unaffected

#### Scenario: An agent with turns carries no implied count

- **WHEN** an agent's window contains at least one turn
- **THEN** its entry carries no implied turn count and no staleness verdict

### Requirement: Registry paths and rollup identities are mapped by one rule

The observer SHALL derive an agent's rollup identity (slug) from its registry path with a single
mapping rule shared by every consumer, and SHALL NOT maintain a second, divergent derivation. A path
that fails to map SHALL be treated as having no declaration rather than as a distinct agent.

#### Scenario: A registry path maps to the rollup identity

- **WHEN** the registry reports a deployment at a path containing upper case and underscores
- **THEN** the derived slug equals the identity the rollup uses for that agent's turns, so its declared rhythm is applied to the right entry

#### Scenario: Mapping happens in exactly one place

- **WHEN** any part of the observer needs an agent's slug from its registry path
- **THEN** it uses that single shared derivation
