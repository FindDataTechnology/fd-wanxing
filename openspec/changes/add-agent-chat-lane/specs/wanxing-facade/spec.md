# Delta: wanxing-facade — 对话车道（chat lane）

## MODIFIED Requirements

### Requirement: External callers authenticate with their own sub2api key

The facade SHALL authenticate every API-lane external request (the per-agent A2A turn surface) by the caller's own sub2api API key presented as a bearer credential, validating it through the auth-only liveness probe that exercises the full billing gate (key validity, balance, group, quota) and resolving the caller's identity by the key's holder. Validation results MAY be cached briefly; every admission decision SHALL reflect a probe no older than the configured cache window. The facade SHALL NOT forward, log, or echo the key value anywhere past the request boundary; audit and metering surfaces SHALL carry at most the key's last four characters. The chat lane authenticates visitors by tenant identity instead (its own requirement below) — the two credential classes never mix on one route.

#### Scenario: A valid solvent key is admitted

- **WHEN** a request arrives with a bearer key that passes the liveness probe
- **THEN** the caller is admitted, the caller identity is resolved from the key's holder, and the request proceeds to agent admission

#### Scenario: A dead or insolvent key is refused at the door

- **WHEN** the probe rejects the key (invalid, exhausted consumption window, or insufficient balance)
- **THEN** the request is refused with a structured error naming the billing-gate reason, and no turn starts

#### Scenario: The key never travels past the facade

- **WHEN** the facade forwards an admitted request toward the agent's runtime route
- **THEN** the forwarded request, its logs, and the ledger contain no key material beyond a masked reference

## ADDED Requirements

### Requirement: Visitors authenticate with tenant identity on the chat lane

The chat turn surface (`/api/wanxing/v1/chat/:agentSlug`) SHALL authenticate visitors by a tenant-issued ID token presented as a bearer credential, verified server-side under the same signature/issuer/audience/expiry discipline as the console gate but WITHOUT the console's email allowlist — any verified tenant identity MAY chat. An unauthenticated, stale, or unverifiable token SHALL be refused with a structured visitor-auth error and no turn starts. The console allowlist SHALL remain management-only: an identity off the allowlist SHALL be admitted on the chat lane and still refused by console routes.

#### Scenario: A verified visitor is admitted without an allowlist

- **WHEN** the chat surface receives a tenant ID token that verifies
- **THEN** the caller is admitted as a visitor (tenant subject as identity) and the request proceeds to chat admission

#### Scenario: An unauthenticated chat request is refused

- **WHEN** the chat surface receives no or an unverifiable bearer token
- **THEN** the response is a 401 structured error and no turn starts

#### Scenario: The console allowlist stays management-only

- **WHEN** an identity not on the console allowlist chats on the chat lane
- **THEN** the chat turn proceeds normally, while console routes continue to refuse that identity

### Requirement: Chat admission follows the chatability gate and the allowance waterfall

The chat lane SHALL admit a visitor to an agent only when the deployment is public AND chatability holds (platform subsidy enabled OR the agent's host allowance has remaining minutes); a private agent's chat surface SHALL answer the agent-not-found error like its card route, and a public agent without chatability SHALL answer an explicit not-open error. For an admitted turn the settler SHALL be resolved before the turn starts by the waterfall: per-visitor daily subsidy remaining → host allowance remaining; when both are exhausted the lane SHALL refuse with a structured allowance-exhausted error carrying an explicit own-key continuation hint, and no turn starts. A paused or undeployed agent SHALL return its explicit state error, matching the API lane.

#### Scenario: A chatable agent admits within subsidy

- **WHEN** a verified visitor sends a turn to a public agent with subsidy enabled and daily subsidy remaining
- **THEN** the turn is admitted with the settler resolved as the platform subsidy

#### Scenario: Subsidy exhausted falls to the host allowance

- **WHEN** the visitor's daily subsidy is spent and the agent's host allowance has remaining minutes
- **THEN** the turn is admitted with the settler resolved as the host allowance

#### Scenario: Both exhausted refuses with the own-key hint

- **WHEN** daily subsidy and the host allowance are both exhausted (or the host has no allowance and subsidy is off)
- **THEN** the response is a 402 structured allowance-exhausted error naming an own-key continuation path, and no turn starts

#### Scenario: A non-chatable public agent answers not-open

- **WHEN** a visitor targets a public agent whose subsidy is off and whose host allowance is zero
- **THEN** the response is the explicit not-open error and no turn starts

#### Scenario: A paused agent answers with its state

- **WHEN** the target agent is paused
- **THEN** the visitor receives the explicit paused error, not a timeout

### Requirement: Chat traffic is bounded tighter than the API lane

The chat lane SHALL enforce its own per-visitor rate limit with a tighter default than the API lane and the same one-in-flight-turn bound per (caller, agent): a burst over the chat rate bound SHALL be throttled with a structured error, and a concurrent second turn SHALL be refused with a retry-after error without affecting the running turn.

#### Scenario: A burst over the chat rate bound is throttled

- **WHEN** a visitor exceeds the chat rate limit
- **THEN** further turns are throttled with a structured rate-limit error

#### Scenario: A concurrent second chat turn is refused with retry-after

- **WHEN** a visitor sends a second turn to the same agent while their previous turn is in flight
- **THEN** the request is refused with a retry-after error and the running turn is unaffected

### Requirement: Chat turns are metered by channel and settled by their settler

Every admitted chat turn SHALL be recorded in the facade ledger with the visitor's identity, the agent, the outcome, the minute-rounded duration, the channel `chat`, and the resolved settler; the ledger is the authoritative record and is retained without pruning. Settlement SHALL follow the settler: host-settled turns SHALL be deducted through the packs internal deployment-settlement contract (idempotent by ledger row identity, with the deployment's billing key value never traveling to the facade), subsidy-settled turns SHALL be deducted from the platform settlement key, and visitor-own-key turns ride the API lane unchanged. Settlement failures SHALL retry with backoff under the same sweep semantics as the API lane.

#### Scenario: A completed chat turn records channel and settler exactly once

- **WHEN** an admitted chat turn completes
- **THEN** the ledger holds one row carrying the visitor identity, agent, outcome, minute-rounded duration, channel `chat`, and the resolved settler

#### Scenario: A host-settled turn deducts via the packs internal contract idempotently

- **WHEN** a host-settled turn completes and the settlement is attempted twice
- **THEN** the deployment's host key is deducted once, and the facade never receives the key value

#### Scenario: A subsidy-settled turn deducts the platform key

- **WHEN** a subsidy-settled turn completes
- **THEN** the platform settlement key is deducted once for the minute-rounded duration

#### Scenario: Settlement failure retries with backoff

- **WHEN** a chat settlement deduction fails transiently
- **THEN** the sweep retries with backoff and the ledger row reflects pending until settled

### Requirement: The daily subsidy is globally switchable and per-visitor bounded

The platform subsidy SHALL be a global switch with a per-visitor daily minute allowance; subsidy consumption SHALL be derived from the ledger (channel `chat`, settler `subsidy`, per visitor per day at the platform day boundary). When the switch is off, no turn SHALL be settled as subsidy (chatability MAY still hold via host allowance), and a turn already admitted keeps its resolved settler.

#### Scenario: Subsidy off disables subsidy settlement only

- **WHEN** the subsidy switch is off and a visitor chats on an agent with a funded host allowance
- **THEN** the turn is admitted and settled as host allowance; no turn settles as subsidy

#### Scenario: The daily allowance bounds subsidy per visitor

- **WHEN** a visitor's subsidy-settled minutes reach the daily allowance
- **THEN** further turns that day resolve their settler to host allowance or are refused per the waterfall

### Requirement: Host allowance is a deployer-gated per-agent cap

Each agent MAY carry one host allowance: a one-time minute cap set or adjusted at any time by that deployment's deployer identity or the ops credential; non-owners SHALL be refused. The remaining allowance SHALL be derived from the ledger (cap minus host-settled minutes for that agent), and an adjusted cap takes effect on the next admission.

#### Scenario: The deployer sets and adjusts the cap

- **WHEN** the deployer of an agent sets a cap and later adjusts it
- **THEN** both writes succeed and the new cap governs the next admission

#### Scenario: A non-deployer cannot change the allowance

- **WHEN** a verified identity that is not the deployment's deployer (and not ops) attempts to set the allowance
- **THEN** the write is refused and the cap is unchanged

### Requirement: Owner-facing usage views aggregate by caller with masking

The facade SHALL serve a per-agent usage view to that deployment's deployer identity (or the ops credential): aggregates by caller and channel (turns, minutes, last activity) plus a bounded recent-activity stream. Visitor identities SHALL be masked for deployer reads (at most a redacted email form); the ops credential MAY read unmasked. A deployer SHALL NOT read another deployment's usage view.

#### Scenario: The deployer reads their agent's aggregates

- **WHEN** the deployer of an agent requests its usage view
- **THEN** per-caller per-channel aggregates and the recent activity stream return

#### Scenario: Visitor identities are masked for deployer reads

- **WHEN** the deployer reads the usage view containing visitor callers
- **THEN** visitor identities render in redacted form, never the full email

#### Scenario: Another deployer is refused

- **WHEN** a deployer requests the usage view of a deployment they did not deploy
- **THEN** the read is refused

### Requirement: The public catalog carries a chatability marker

The public catalog and agent card summaries SHALL carry a chatability marker derived from the chatability gate, served from the cached snapshot with the snapshot's freshness semantics; the marker SHALL NOT leak private agents or allowance amounts.

#### Scenario: The catalog marks chatable agents

- **WHEN** the catalog lists public agents and one of them is chatable
- **THEN** that entry carries the chatability marker and non-chatable entries do not

#### Scenario: The marker leaks nothing beyond the boolean

- **WHEN** an anonymous party reads the catalog or a card
- **THEN** the entry exposes the chatability boolean only — no allowance amounts, no subsidy state beyond it, no private agents
