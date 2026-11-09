# wanxing-web Specification (delta)

## ADDED Requirements

### Requirement: The fleet view surfaces unhealthy agents first

The deployer console's fleet view SHALL render a health marker per deployment
derived from the observer's agent health, and SHALL order unhealthy deployments
above healthy ones within the view's existing grouping. A deployment reported as
`failing` SHALL state how long it has been failing and the failure cause when
known; a deployment reported as `silent` SHALL be marked as having no traffic
rather than as healthy or failing. Paused deployments SHALL be marked as paused.

#### Scenario: A failing deployment sorts to the front and explains itself

- **WHEN** the deployer opens the fleet view and one of their deployments is failing
- **THEN** that deployment appears above healthy ones, shows the failing duration, and names the failure cause when it is known

#### Scenario: A silent deployment is not presented as healthy

- **WHEN** a deployment has had no turns in the window
- **THEN** it is marked as no-traffic rather than carrying a healthy marker

#### Scenario: Health data unavailable degrades honestly

- **WHEN** the observer's health section is missing or unreachable
- **THEN** the fleet view renders without health markers and does not imply the deployments are healthy

### Requirement: The ops view lists every unhealthy agent with its duration

The ops view SHALL list all agents currently failing or degraded across the fleet
with their failing duration and failure cause, and SHALL offer a pointer to the
per-agent view where the cause can be inspected.

#### Scenario: Ops sees the whole unhealthy set at once

- **WHEN** ops opens the ops view
- **THEN** every currently failing or degraded agent is listed with its duration and cause

#### Scenario: The empty state is explicit

- **WHEN** no agent is failing or degraded
- **THEN** the view states that explicitly instead of rendering an empty list
