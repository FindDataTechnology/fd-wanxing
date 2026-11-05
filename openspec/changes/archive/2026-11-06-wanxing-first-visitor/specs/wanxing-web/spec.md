## ADDED Requirements

### Requirement: Catalog cards open a detail view

Each catalog card SHALL open a detail view (route or drawer) presenting the agent's description, tags/skills, example prompts, activity signal (turns7d), chatability state, and the chat entry; example prompts deep-link into the chat view with the draft pre-filled as today.

#### Scenario: A visitor inspects an agent

- **WHEN** a visitor clicks a catalog card
- **THEN** the detail view opens in place (no dead click), showing all listed fields and a working chat entry for chatable agents

#### Scenario: Non-chatable agent detail

- **WHEN** a visitor opens the detail view of a non-chatable agent
- **THEN** example prompts render read-only with an honest explanation of why chat is unavailable (mirroring today's gray rendering, now with a reason)

### Requirement: The docs face states the concrete base URL and discovery endpoints

The docs one-pager SHALL state the concrete public base URL (`https://wanxing.finddatatech.cloud`) in place of the `$BASE` placeholder, list the `.well-known/agent-card.json` discovery endpoint, and document the caller preferences API surface; every curl sample SHALL be copy-paste runnable against production.

#### Scenario: First integration command

- **WHEN** a new integrator copies the first curl from the docs page
- **THEN** it runs against production unmodified and returns a real card

### Requirement: The intro page carries pricing and an about statement

The intro view SHALL state the current billing model as a concrete price table (per-minute/turn rates as configured in the billing plane) and an about section (what Wanxing is, operator identity), consistent with the footer statements; absent a published rate the table SHALL say so honestly rather than inventing numbers.

#### Scenario: A visitor evaluates cost

- **WHEN** a visitor reads the intro page
- **THEN** they can determine what serving costs (or that rates are unpublished) without leaving the site

### Requirement: The site footer carries a live status strip

The site footer SHALL render a live status strip fed by the curated public status endpoint — catalog size, 7-day turns, settlement pending — with graceful degradation to a static line when the endpoint is unreachable.

#### Scenario: Status strip renders

- **WHEN** a visitor loads any public page with the status endpoint healthy
- **THEN** the footer shows the three aggregates; when the endpoint fails, the footer falls back to a static line without layout breakage

### Requirement: The ops tab hides ops-only panels from non-ops identities

The ops view SHALL render ops-only management panels (plan management, approval queue) only for identities holding the ops role; non-ops deployers SHALL NOT see panels that would only render a 403 error.

#### Scenario: A plain deployer opens ops

- **WHEN** a deployer without the ops role opens the ops tab
- **THEN** they see the board/timeline but no ops-management panels, and no 403 error text renders

### Requirement: Collection deletion confirms and reports errors

Deleting a collection SHALL require explicit confirmation and SHALL surface failure with an error state (retry affordance); deletion success updates the list optimistically-or-on-ack but MUST NOT silently close on failure as today.

#### Scenario: Delete fails server-side

- **WHEN** a deployer confirms deletion and the API errors
- **THEN** an error state renders with the collection still present and a retry path

### Requirement: The chat view lets visitors clear and export history

The chat view SHALL provide explicit controls to clear local history (with confirmation) and export it (download as text/JSON); clearing is local-first and SHALL state that server-side persistence is not implied.

#### Scenario: A visitor clears history

- **WHEN** a visitor confirms clear-history
- **THEN** local storage for that agent is emptied and the view resets to empty state

#### Scenario: A visitor exports history

- **WHEN** a visitor exports history
- **THEN** a file downloads containing the local transcript, including turns from the current device only

### Requirement: The embed lane ships a runnable host demo page

The docs face (or a sibling route) SHALL ship a self-contained, copy-deployable host demo page demonstrating the postMessage protocol — init, host context, ask cards, host intents with confirmation — against production; it SHALL be the executable reference for `copilot-intent-adherence` adoption.

#### Scenario: A deployer verifies embedding

- **WHEN** a deployer hosts the demo page and opens their agent's embed lane in it
- **THEN** init/context/intents flow completes against production, demonstrating each protocol step visibly
