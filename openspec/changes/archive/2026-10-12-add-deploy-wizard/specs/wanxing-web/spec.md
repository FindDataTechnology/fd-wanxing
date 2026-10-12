## ADDED Requirements

### Requirement: The deploy panel walks a stepped deployment wizard

The deployer console's deploy panel SHALL present deployment as a stepped wizard replacing the raw four-field form: (1) choose a pack from my/packs — only deployable packs enter the wizard, undeployable ones stay visible with their reason badge; (2) check the serving agents to deploy — deployableAgents checkboxes defaulting to all, at least one required; (3) per-agent configuration — model (hinted by the declared modelWhitelist when present), turn budget in minutes, and work rhythm via presets plus a custom-JSON escape hatch, every field optional with the declared default shown as the fallback; (4) billing and notification — the sub2api billing key with its panel guidance link and the optional notify channel. Each step SHALL be independently visible and revisitable, and the wizard SHALL NOT block navigation away. The submit SHALL carry the wizard payload (selected agents, per-agent config, billing key, notify channel) to the facade's deploy endpoint and surface its structured refusal verbatim.

On success the result step SHALL show the share card (chat URL, chatability verdict, allowance guidance) plus the visibility close-out affordances brought forward from the management area: setting the host allowance (chat opening) and adding an allowlist caller (API access) — both operating on the freshly deployed slug through their existing endpoints. Failure of a close-out action SHALL be shown inline without undoing the deployment.

#### Scenario: The wizard replaces the raw form

- **WHEN** a signed-in deployer opens the deploy panel with at least one deployable pack
- **THEN** the panel renders the stepped wizard (pack choice → agent checkboxes → per-agent config → billing/notification), not the legacy four-field row form

#### Scenario: Agents are checked before anything deploys

- **WHEN** the deployer unchecks every agent and tries to proceed
- **THEN** the wizard refuses to advance naming the requirement, and no request is sent

#### Scenario: Per-agent config rides the deploy

- **WHEN** the deployer sets a model within the declared whitelist, a budget of 20 minutes, and an hourly rhythm preset for the selected agent, then submits with a billing key
- **THEN** the request body carries the agent selection and those per-agent values, and the result step shows the deployed slug

#### Scenario: A structured refusal surfaces verbatim

- **WHEN** the facade/facet refuses the deploy (bad billing key, lane rejection, bad subset)
- **THEN** the wizard shows the refusal's error text on the billing step without losing the entered configuration

#### Scenario: Visibility close-out follows a fresh deployment

- **WHEN** the result step renders for a freshly deployed slug
- **THEN** the share card shows the chat URL and chatability verdict, and the deployer can set the host allowance and add an allowlist caller right there; a failing close-out action shows its error inline while the deployment itself stays live
