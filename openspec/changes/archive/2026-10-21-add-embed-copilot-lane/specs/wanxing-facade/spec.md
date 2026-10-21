## MODIFIED Requirements

### Requirement: Visitors authenticate with tenant identity on the chat lane

The chat turn surface (`/api/wanxing/v1/chat/:agentSlug`) SHALL authenticate visitors by one of the accepted credential shapes presented as a bearer: (a) a tenant-issued ID token verified server-side under the same signature/issuer/expiry discipline as the console gate, for the console client OR any client on the configured embed audience allowlist, in both cases WITHOUT the console's email allowlist; or (b) a facade-minted short-lived ephemeral token bound to an anonymous visitor (see the ephemeral credential requirement). An unauthenticated, stale, or unverifiable credential SHALL be refused with a structured visitor-auth error and no turn starts. The console allowlist SHALL remain management-only: an identity off the allowlist SHALL be admitted on the chat lane and still refused by console routes.

#### Scenario: A verified visitor is admitted without an allowlist

- **WHEN** the chat surface receives a tenant ID token that verifies
- **THEN** the caller is admitted as a visitor (tenant subject as identity) and the request proceeds to chat admission

#### Scenario: A host-relayed ID token on the audience allowlist is admitted

- **WHEN** the chat surface receives a tenant ID token whose audience is a product-line client on the configured embed audience allowlist
- **THEN** the caller is admitted as a visitor under that tenant subject, identically to the console client shape

#### Scenario: An unauthenticated chat request is refused

- **WHEN** the chat surface receives no or an unverifiable bearer credential
- **THEN** the response is a 401 structured error and no turn starts

#### Scenario: The console allowlist stays management-only

- **WHEN** an identity not on the console allowlist chats on the chat lane
- **THEN** the chat turn proceeds normally, while console routes continue to refuse that identity

## ADDED Requirements

### Requirement: Anonymous visitors ride facade-minted ephemeral credentials

The facade SHALL mint short-lived signed ephemeral tokens for anonymous embedding visitors on a per-agent mint route: a mint request SHALL be origin-gated (the requesting embedding origin MUST be allowed for that agent — per-agent deployer list or the platform list) and rate-bounded per source; a minted token carries a fresh ephemeral visitor identity, a bounded lifetime, and SHALL be renewable from inside the widget. Ephemeral credentials SHALL NOT carry tenant identity or console rights, and an expired one SHALL be refused on turns with the visitor-auth error.

#### Scenario: A widget on an allowed origin mints an ephemeral token

- **WHEN** the mint endpoint is called for an agent from an embedding origin allowed for that agent
- **THEN** a short-lived ephemeral credential is issued carrying a fresh anonymous visitor identity

#### Scenario: A mint from a disallowed origin is refused

- **WHEN** the mint endpoint is called for an agent from an origin not allowed for it
- **THEN** the response is a structured refusal and no credential is issued

#### Scenario: An expired ephemeral token is refused on turns

- **WHEN** a chat turn presents an expired ephemeral token
- **THEN** the turn is refused with the structured visitor-auth error

### Requirement: Anonymous chat is double-gated and separately bounded

Anonymous turns SHALL be admitted only when the platform anonymous switch is on AND that agent's deployer has enabled anonymous access; anonymous admission SHALL NOT consume host allowance under any condition. Anonymous minutes SHALL be bounded per ephemeral identity per platform day at an allowance independent of (and tighter than) the logged-in subsidy allowance, settled by the platform subsidy key, and derived from the ledger with a tier marker distinguishing anonymous from tenant visitors. When a gate or the anonymous quota refuses a turn, the lane SHALL answer a structured error carrying an explicit login-upgrade hint, and no turn starts.

#### Scenario: Both gates open admits anonymous within quota

- **WHEN** the anonymous switch is on, the agent has anonymous enabled, and the ephemeral identity has anonymous minutes left today
- **THEN** the turn is admitted and settled by the platform subsidy under the anonymous allowance

#### Scenario: The agent-level switch refuses anonymous

- **WHEN** the agent's deployer has not enabled anonymous access
- **THEN** an ephemeral-credentialed turn is refused with the login-upgrade error

#### Scenario: Anonymous never draws host allowance

- **WHEN** an anonymous visitor's daily minutes are exhausted and the agent's host allowance is funded
- **THEN** the turn is still refused with the login-upgrade error and host allowance remains untouched

#### Scenario: The anonymous allowance is independent of the subsidy allowance

- **WHEN** an ephemeral identity has spent the anonymous allowance for the day and a tenant visitor chats from the same browser
- **THEN** the tenant visitor's subsidy remains governed by the logged-in subsidy allowance, not the anonymous one

### Requirement: Embedding origins and embed configuration are deployer-managed

Each agent MAY carry a deployer-managed list of allowed embedding origins; the platform MAY carry a global fallback list; deployer writes are gated to the deployment's owner (or ops) and take effect on the next mint. The facade SHALL serve a public per-agent embed configuration endpoint answering the widget's cold-start questions — chatability, anonymous availability, and theme defaults — without exposing keys, tokens, or quota internals.

#### Scenario: The deployer manages allowed origins

- **WHEN** the deployer adds or removes an origin for their agent
- **THEN** the next mint attempt from that origin is admitted or refused accordingly

#### Scenario: The embed configuration is public and secret-free

- **WHEN** the widget fetches the agent's embed configuration without credentials
- **THEN** it learns chatability, anonymous availability, and theme defaults, and no keys or tokens appear in the payload
