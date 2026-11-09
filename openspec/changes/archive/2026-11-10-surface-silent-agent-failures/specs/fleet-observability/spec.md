# fleet-observability Specification (delta)

## ADDED Requirements

### Requirement: Each agent carries a derived health state

The observer SHALL derive, from the existing hourly rollup, a health state per agent over a bounded window and SHALL expose it as `ok`, `degraded`, `silent`, `paused`, or `failing`. The state SHALL distinguish "no turns" from "all turns failing" — a window with zero turns SHALL be reported as `silent`, never as healthy and never as failing.

`failing` SHALL require both that every turn in the window failed and that the agent's consecutive failure volume reaches an independently configured minimum; it SHALL NOT be derived from a percentage alone. `degraded` SHALL require a mix of successful and failed turns with the failure ratio at or above an independently configured threshold. An agent whose registry entry marks it paused SHALL be reported as `paused` regardless of its turn outcomes.

#### Scenario: An agent that fails every turn is failing

- **WHEN** an agent has at least one turn in the window, every turn failed, and its consecutive failure volume reaches the configured minimum
- **THEN** its health state is `failing` and the response carries how long it has been failing

#### Scenario: No traffic is silent, not healthy and not failing

- **WHEN** an agent has zero turns in the window
- **THEN** its health state is `silent`

#### Scenario: A paused agent is never reported as failing

- **WHEN** an agent's registry entry marks it paused and its recent turns all failed
- **THEN** its health state is `paused` and it is excluded from the unhealthy set

#### Scenario: A mixed agent is degraded, not failing

- **WHEN** an agent has both successful and failed turns and its failure ratio is at or above the configured threshold but not every turn failed
- **THEN** its health state is `degraded`

#### Scenario: Thresholds are independent of any polling period

- **WHEN** the failing minimum, the degraded ratio, and the window length are configured
- **THEN** each is read from its own setting and none is computed from a scheduler or poll interval

### Requirement: Health carries a failure cause, and "unknown" is distinct from "none"

A health entry SHALL carry the kind of the most recent failure, derived from existing turn event payloads where available, and SHALL answer `unknown` when a failure occurred but no classification could be derived. For an agent with no failure in the window the field SHALL be absent or null — never the string `unknown`.

#### Scenario: A cold-start failure is classified

- **WHEN** the most recent failure was a cold-start resolution failure
- **THEN** the health entry reports that cause rather than a generic error

#### Scenario: Unclassified failure is unknown, healthy is null

- **WHEN** a failing turn carried no recognisable cause
- **THEN** the entry answers `unknown`; and when the agent has no failure in the window the field is null

#### Scenario: An unreachable dependency does not fabricate a state

- **WHEN** the registry cannot be reached so the pause flag cannot be read
- **THEN** that agent's health is skipped as stale for the pass instead of being reported as healthy

### Requirement: Health transitions emit one edge event

The observer SHALL emit an `agent_unhealthy` event when an agent's health crosses into `failing`, and a paired recovery event when it leaves, at most once per transition rather than once per failing turn. The event payload SHALL carry the agent, the failing-since timestamp, the consecutive volume, the failure cause, and the window length. A repeated computation for a transition already emitted SHALL NOT emit again.

#### Scenario: Crossing into failing emits once

- **WHEN** an agent's health changes from a non-failing state to `failing`
- **THEN** exactly one `agent_unhealthy` event is emitted for that transition

#### Scenario: Continued failing does not re-emit

- **WHEN** a subsequent computation still finds the same agent failing with the same start
- **THEN** no further event is emitted

#### Scenario: Recovery is emitted in the same shape

- **WHEN** a failing agent's health returns to a non-failing state
- **THEN** one recovery event is emitted carrying the same failing-since reference so the pair can be matched
