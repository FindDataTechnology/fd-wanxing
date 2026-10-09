# Delta: wanxing-web — 对话视图与主人记录面

## ADDED Requirements

### Requirement: The chat view lets logged-in visitors converse with a chatable agent

The web face SHALL serve a chat view at `#/chat/:slug` for public agents: a visitor login gate (the tenant identity login, reused from the console's auth plumbing), the agent's name and description, a remaining-allowance display (today's subsidy and the agent's host pool, minutes with an approximate-turn hint), a message input with streamed replies (SSE), and conversation history held client-side only — the server persists no conversation content. When the lane answers the allowance-exhausted error, the view SHALL render the exhaustion state with an own-key continuation input: a pasted caller key stored client-side, after which turns ride the API lane as that key's caller. A not-chatable agent SHALL render an explicit not-open state, never an empty chat masquerading as unavailable.

#### Scenario: A logged-in visitor chats with streaming

- **WHEN** a verified visitor sends a message to a chatable agent
- **THEN** the reply streams in incrementally and appends to the client-side history

#### Scenario: The login gate precedes chat

- **WHEN** an unauthenticated visitor opens the chat view
- **THEN** the login prompt renders and no turn can be sent

#### Scenario: Remaining allowance is visible

- **WHEN** the chat view loads for a chatable agent
- **THEN** today's remaining subsidy and the agent's host-pool remaining render in minutes

#### Scenario: Exhaustion offers the own-key bridge

- **WHEN** a turn is refused with the allowance-exhausted error
- **THEN** the view renders the exhaustion state with an own-key input, and a pasted key switches subsequent turns to the API lane

#### Scenario: History stays client-side

- **WHEN** a visitor returns to the chat view on the same browser
- **THEN** prior history renders from client-side storage; the server holds no conversation content

### Requirement: The catalog links chatable agents to the chat view

The catalog page SHALL link an agent card to its chat view (a chat entry point) exactly when the card carries the chatability marker; non-chatable cards SHALL NOT render a chat entry.

#### Scenario: A chatable card links to chat

- **WHEN** the catalog renders an agent carrying the chatability marker
- **THEN** the card offers the chat entry point navigating to that agent's chat view

#### Scenario: A non-chatable card offers no chat entry

- **WHEN** the catalog renders an agent without the marker
- **THEN** the card renders no chat entry point

### Requirement: The console carries invocation records and the host-allowance panel

The deployer console's agent detail SHALL carry an invocation-records panel — per-caller per-channel aggregates (turns, minutes, last activity) with visitor identities masked, plus a recent activity stream — and a host-allowance panel where the deployer (or the ops credential) views and edits that agent's allowance cap. The records panel SHALL visibly distinguish the api and chat channels and degrade explicitly when the usage view is unreachable.

#### Scenario: The deployer reads invocation records

- **WHEN** the deployer opens an agent's records panel
- **THEN** per-caller per-channel aggregates and recent activity render with visitor identities masked

#### Scenario: The deployer edits the host allowance

- **WHEN** the deployer sets a new allowance cap in the panel
- **THEN** the write succeeds and the panel reflects the new cap and its remaining minutes

#### Scenario: Records degrade visibly on backend failure

- **WHEN** the usage view is unreachable
- **THEN** the panel shows an explicit error state, never an empty list masquerading as "no callers"
