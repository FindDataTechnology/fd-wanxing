# Spec Delta

## MODIFIED Requirements

### Requirement: Catalog cards open a detail view

Each catalog card SHALL open a detail view presenting, in three readable parts: what the agent is (name, version,
one-sentence positioning, tags/skills when declared), how it is doing now (the single primary status fact, the
7-day turn count, and the snapshot instant the status was taken from), and how to reach it (the chat entry, a
copy-pasteable A2A call sample carrying the agent's own route, and the one-line embed script), plus the
visibility the visitor is subject to (public, paused, or login required) stated in words rather than implied by
a disabled control. Example prompts deep-link into the chat view with the draft pre-filled; when the agent
declares no examples the detail SHALL NOT invent any, and SHALL offer the plain chat entry instead.

The detail view SHALL read the agent's card face (`…/.well-known/agent-card.json`) for the fields the catalog
list cannot carry faithfully — skills with their descriptions, the version, the declared example prompts — and
MUST NOT enumerate the whole catalog to locate one agent. The version and skills it shows SHALL agree with what
that agent's card reports.

#### Scenario: A visitor inspects an agent

- **WHEN** a visitor clicks a catalog card
- **THEN** the detail view opens in place (no dead click), showing what the agent is, its current status with the snapshot instant, and a working chat entry for chatable agents

#### Scenario: Non-chatable agent detail

- **WHEN** a visitor opens the detail view of a non-chatable agent
- **THEN** the chat entry is replaced by an honest statement of why chat is unavailable, and the A2A and embed entry points remain available

#### Scenario: an agent with no declared examples

- **WHEN** the detail view renders an agent whose examples array is empty
- **THEN** no example prompt is fabricated and the chat entry stands alone

#### Scenario: the detail names the visibility

- **WHEN** a visitor opens the detail view of a paused or private agent
- **THEN** the reason they cannot chat is stated in words ("已暂停" / "需登录" / "未对访客开放"), not left to a grayed control

#### Scenario: Skill descriptions come from the card face

- **WHEN** an agent declares skills that carry descriptions
- **THEN** the detail view lists each skill with its description, and the version shown equals the card's version

#### Scenario: An unknown slug is reported, not searched for

- **WHEN** a visitor opens a detail URL for a slug that has no public agent
- **THEN** the view reports the agent as not found, and no full-catalog enumeration is issued to establish that
