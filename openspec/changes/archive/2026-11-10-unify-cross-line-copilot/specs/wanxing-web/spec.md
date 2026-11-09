# wanxing-web Specification (delta)

## ADDED Requirements

### Requirement: A loader script mounts a line's copilot in one tag

wanxing-web SHALL serve a self-hosted loader script that a product-line page mounts with a single tag naming the line (`data-line`), with no protocol code written by the host. The loader SHALL resolve that line's binding before mounting, create the widget iframe itself, run the entire host protocol on the host's behalf (handshake, page-context pushes, per-turn identity relay, intent dispatch), and expose optional declarative hooks: an identity provider, a context provider, and an intent handler map. A host that supplies none SHALL still get a working widget on whatever visitor tier the binding permits.

The loader SHALL NOT mount the widget when the resolution answers unbound, unknown, paused, or closed, and SHALL report the reason once in the console instead of injecting a dead surface. The iframe source and behavior SHALL remain obtainable directly (the existing embed view URL), so the loader is a host-side convenience, never a new admission path.

#### Scenario: One tag mounts a working copilot

- **WHEN** a page includes the loader tag for a line bound to a ready agent and supplies no hooks
- **THEN** the widget mounts and a visitor message runs a turn on the tier the binding's effective policy permits

#### Scenario: No binding means no widget

- **WHEN** the loader tag names an unbound, unknown, paused, or closed line
- **THEN** nothing is injected into the page and one console message names the reason

#### Scenario: Host hooks replace host-written protocol

- **WHEN** the page supplies an identity provider before the first turn
- **THEN** the loader relays the token per turn without the host writing any postMessage code, and the widget prefers it over the anonymous tier

#### Scenario: Declared intents are the only executable ones

- **WHEN** the page supplies an intent handler for a verb the loader declares at handshake
- **THEN** only that verb executes against the handler and every other verb is answered as unsupported

#### Scenario: The direct embed URL keeps working

- **WHEN** a page embeds the existing embed view URL directly, without the loader
- **THEN** the widget behaves exactly as before the loader existed

### Requirement: The console carries the line-copilot binding panel

The console SHALL carry an ops-only panel listing every line binding (line, bound agent, accent, intended visitor policy), the effective anonymous state resolved for it, and an explicit gap indicator when intent and effect disagree. Binding SHALL offer a deployment picker restricted to public deployments and an accent field; each row SHALL offer unbind behind a two-step confirmation. Non-ops identities SHALL NOT see the panel, consistent with the existing ops-panel visibility rule.

#### Scenario: A gap between intent and effect is visible

- **WHEN** a line is bound with anonymous intended but the agent's anonymous setting is off
- **THEN** the row names the gap and the widget's resulting behaviour for a visitor without host identity

#### Scenario: An agent pause shows through

- **WHEN** the bound deployment is paused
- **THEN** the row shows the closed state and the line's outward copilot stops mounting

#### Scenario: Unbind is confirmed and takes effect

- **WHEN** ops confirms unbinding a line
- **THEN** the row disappears and the line's resolution answers unbound

### Requirement: The chat view renders in-flight asks as answerable cards

The in-site chat view SHALL dispatch streamed frames by event name and SHALL render an `ask` event as an answerable inquiry card with the same question, option, free-text, cancel, and deadline behaviour the embed view offers, answering through the same answer route under the view's credential. Replayed history SHALL render an ask as a static resolved summary. A late or refused answer SHALL converge to the resolved state rather than leaving a live card.

#### Scenario: An in-site visitor answers an ask

- **WHEN** a streamed turn on `#/chat/:slug` carries an `ask` event
- **THEN** the card renders, the composer locks, and the submitted answer continues the turn

#### Scenario: Chat and embed describe one ask the same way

- **WHEN** the same ask is rendered in the chat view and the embed view
- **THEN** both show the same questions, options, deadline behaviour, and resolved summary wording

### Requirement: The login upgrade names the platform it signs the visitor into

When a widget cannot serve a visitor on an anonymous tier and no host identity is available, the login affordance SHALL name the platform the visitor is about to sign into, so a visitor arriving from a product-line page is never implicitly asked to create an account on a product they did not open. When a host identity provider is available, that path SHALL be offered first.

#### Scenario: The upgrade names the destination

- **WHEN** an anonymous visitor hits the upgrade affordance from a third-party page
- **THEN** the affordance and its copy identify the sign-in platform by name

#### Scenario: Host identity is preferred over the popup

- **WHEN** the embedding page supplies an identity provider and the visitor is signed in there
- **THEN** turns run on the relayed identity and the popup upgrade is not offered as the primary path

## MODIFIED Requirements

### Requirement: The chat view lets logged-in visitors converse with a chatable agent

The web face SHALL serve a chat view at `#/chat/:slug` for public agents: a visitor login gate (the tenant identity login, reused from the console's auth plumbing), the agent's name and description, a remaining-allowance display (today's subsidy and the agent's host pool, minutes with an approximate-turn hint), a message input with streamed replies (SSE), and conversation history held client-side only — the server persists no conversation content. The chat view and the embed view SHALL share one conversation core (history persistence, context identity, own-key bridge, text rendering, stream dispatch, ask handling) rather than each keeping a parallel implementation, and the chat view SHALL carry the visitor's client-side history across the transition from the pre-unification storage keys. When the lane answers the allowance-exhausted error, the view SHALL render the exhaustion state with an own-key continuation input: a pasted caller key stored client-side, after which turns ride the API lane as that key's caller. A not-chatable agent SHALL render an explicit not-open state, never an empty chat masquerading as unavailable.

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

#### Scenario: Existing local history survives the shared-core migration

- **WHEN** a returning visitor has history written under the pre-unification client-side keys
- **THEN** that history renders in the same view without loss, and subsequent turns persist under the unified keys
