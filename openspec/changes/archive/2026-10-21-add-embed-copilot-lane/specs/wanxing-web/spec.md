## ADDED Requirements

### Requirement: The embed view carries the copilot widget for cross-site embedding

wanxing-web SHALL serve an embeddable widget view (`#/embed/:slug`) — a floating-dock conversation surface (launcher + panel) that runs inside cross-site iframes, streams turns over the chat lane with the same mechanics as the chat view, accepts theme parameters from the embedding URL, and renders a context bar. The embed view SHALL NOT render console surfaces, site header/footer, or site chrome.

#### Scenario: An iframe load renders the widget

- **WHEN** a product-line page embeds the embed view for a chatable agent
- **THEN** the widget renders, streams a conversation turn over SSE, and shows no console or site chrome

#### Scenario: Theme parameters restyle the widget without a rebuild

- **WHEN** the embedding URL carries theme parameters
- **THEN** the widget adopts them at load with no build-time variant

### Requirement: The widget starts anonymous and upgrades by login in place

The embed view SHALL begin conversations on a freshly minted ephemeral credential whenever the agent's embed configuration permits anonymous access, with no login step; it SHALL offer an in-place login upgrade whose popup result returns to the widget via a postMessage handoff into the widget's own partitioned storage, without relying on cross-partition storage events; the identity tier in use SHALL be visible while anonymous, and an anonymous refusal or exhaustion SHALL surface the login-upgrade affordance.

#### Scenario: First chat needs no account

- **WHEN** a visitor opens an embedded widget for an anonymous-enabled agent and sends a message
- **THEN** the turn runs on a freshly minted ephemeral credential with no login step

#### Scenario: Popup login handoff survives storage partitioning

- **WHEN** the visitor completes the popup login opened from inside the iframe
- **THEN** the popup posts the credential to its opener, the widget stores it in its own partitioned storage, and subsequent turns run as the tenant identity

#### Scenario: The identity tier is visible with an upgrade affordance

- **WHEN** the widget runs anonymous
- **THEN** the visible state names the anonymous tier and offers the login upgrade

#### Scenario: Anonymous exhaustion surfaces the upgrade path

- **WHEN** an anonymous turn is refused by quota or gate with the login-upgrade error
- **THEN** the widget renders that explicit state instead of a generic failure

### Requirement: Host-relayed identity tokens are requested per turn, not persisted

The embed view SHALL accept a tenant identity token relayed by the embedding host via postMessage from a declared origin, use it for chat turns without persisting it beyond the widget session, and prefer it over the anonymous tier when present and valid; relay attempts from unexpected origins SHALL be ignored.

#### Scenario: A relayed token upgrades the lane silently

- **WHEN** the host relays a valid tenant ID token from its declared origin
- **THEN** subsequent turns run as that tenant identity with no login popup

#### Scenario: A relay from a foreign origin is ignored

- **WHEN** an identity token arrives by postMessage from an origin the widget did not expect
- **THEN** it is discarded and the widget stays on its current tier

### Requirement: Host context rides the first turn visibly

The embed view SHALL accept page context pushed by the embedding host via postMessage only from the expected origin, deliver it to the agent as a clearly marked host-provided context prefix on the turn input (data, not instruction), and display exactly what was accepted in the context bar. Context from unexpected origins SHALL be ignored.

#### Scenario: Host context reaches the agent

- **WHEN** the host page pushes context before the visitor's first message
- **THEN** the turn input carries the context as a marked prefix and the context bar shows what was sent

#### Scenario: Context from a foreign origin is ignored

- **WHEN** a context postMessage arrives from an unexpected origin
- **THEN** it is discarded and no turn content changes
