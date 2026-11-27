# wanxing-facade Specification

> Forked from paas 2026-10-04 (program slice ②, add-facade-extraction),
> carrying the add-wanxing-deployments-cache delta already applied — this
> repo's spec text is the extraction-era truth; paas marks its copy moved at
> cutover.

## Purpose

The external serving front door of the agent platform (ADR-0014): the Wanxing facade authenticates external callers by their own sub2api caller keys, admits them per agent visibility and per-agent allowlists, bounds and deduplicates their traffic, speaks A2A natively at per-agent routes, meters every admitted turn, and settles the caller's key at the boundary. Alongside this API lane the facade serves a human chat lane: visitors authenticate by tenant identity and converse with public agents, each turn settled through the subsidy→host-allowance waterfall with caller and settler separated (ADR-0002). The registry stays internal; internal callers are unaffected.

## Requirements

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

### Requirement: Agent admission follows visibility and per-agent allowlists

The facade SHALL admit an authenticated caller to an agent according to the deployment's visibility: a public agent admits any caller passing the key gate; a private agent admits only callers whose sub2api account is on that agent's caller allowlist, which the deployer manages on the pack deploy surface. A paused or undeployed agent SHALL return its explicit state error rather than a timeout.

#### Scenario: A public agent serves any valid caller

- **WHEN** an authenticated caller invokes a public agent
- **THEN** the request is admitted without any allowlist check

#### Scenario: A private agent serves only allowlisted callers

- **WHEN** an authenticated caller invokes a private agent and the caller's account is not on that agent's allowlist
- **THEN** the request is refused with a not-authorized error naming the agent, and no turn starts

#### Scenario: A paused agent answers with its state

- **WHEN** the target agent is paused
- **THEN** the caller receives an explicit paused error, not a timeout

### Requirement: The facade speaks A2A natively at per-agent routes

The facade SHALL expose each deployed agent at a stable external route derived from the agent's deployment identity, accepting JSON-RPC `message/send` (synchronous final response) and `message/stream` (SSE passthrough) at the agent's base path, serving its AgentCard at the well-known card path without authentication, and listing public agents with card summaries in a public catalog. Route resolution and the catalog SHALL be served from the cached deployment-bookkeeping snapshot rather than a per-request full fetch. The catalog SHALL support `page`/`page_size` pagination; a request without pagination parameters SHALL return the full list (backward compatible). Unsupported A2A methods SHALL return the protocol's method-not-found error. The facade SHALL forward admitted requests to the agent's runtime route over the platform's internal credentials without altering A2A protocol semantics. Unless the caller supplies a `context_id`, the facade SHALL derive a fresh external context per idempotency key.

#### Scenario: Send returns the agent's completed reply

- **WHEN** an admitted caller invokes `message/send` with a text part
- **THEN** the response returns the agent's reply as text parts once the turn completes

#### Scenario: Stream passes deltas through

- **WHEN** an admitted caller invokes `message/stream`
- **THEN** SSE events pass through incrementally and the stream terminates when the turn completes

#### Scenario: Card and catalog are public

- **WHEN** an unauthenticated party fetches an agent's well-known card path or the agent catalog
- **THEN** public agents' cards and summaries are returned without any credential

#### Scenario: Route resolution reads the snapshot

- **WHEN** an external turn arrives for an agent slug
- **THEN** the slug resolves against the cached snapshot in constant time, without a per-request full bookkeeping fetch

#### Scenario: Catalog paginates on request

- **WHEN** the catalog is requested with `page` and `page_size`
- **THEN** the response contains that page of public agents plus a `total` count, and a request without pagination parameters returns the full list

#### Scenario: A caller-supplied context continues

- **WHEN** an admitted caller reuses a `context_id` it previously used
- **THEN** the conversation continues on that context's runtime session, subject to idle reaping

#### Scenario: Unsupported method

- **WHEN** an admitted caller invokes an A2A method the facade does not implement
- **THEN** a JSON-RPC method-not-found error is returned and no turn runs

### Requirement: Idempotency-Key deduplicates turns

The facade SHALL deduplicate `message/send` requests by the `Idempotency-Key` header, scoped per (caller, agent): a repeated key within the retention window returns the recorded first outcome without running another turn, and concurrent duplicates result in exactly one turn. Key reuse SHALL be hardened as in paas fix-agent-serving-stability: a key replayed with a DIFFERENT request body fingerprint SHALL be refused with a structured error (never silently treated as a duplicate), an errored first outcome SHALL be recorded and returned on replay (error turns SHALL NOT re-execute), and the stored record SHALL bind the request fingerprint so body-swaps cannot inherit another turn's result.

#### Scenario: A replayed key returns the recorded outcome

- **WHEN** the same (caller, agent, Idempotency-Key) is replayed after the first request completed
- **THEN** the recorded first outcome is returned and no second turn runs

#### Scenario: Concurrent duplicates run one turn

- **WHEN** two requests with the same Idempotency-Key race while the first turn is still running
- **THEN** exactly one turn executes and both callers receive its outcome

#### Scenario: Key reuse with a different body is refused

- **WHEN** a caller sends the same Idempotency-Key with a request body whose fingerprint differs from the recorded one
- **THEN** the facade refuses the request with a structured key-reuse error and no turn runs

#### Scenario: An errored turn is not re-executed on replay

- **WHEN** the first turn with a key ended in an error and the same (caller, agent, key, body) is replayed
- **THEN** the recorded error outcome is returned as-is and the turn is not executed again

### Requirement: External traffic is bounded per caller and agent

The facade SHALL bound in-flight turns to one per (caller, agent): a second concurrent request SHALL be refused with a structured retry-after error, never interleaved into the running turn. The facade SHALL additionally enforce a configurable per-caller rate limit across agents.

#### Scenario: A concurrent second turn is refused with retry-after

- **WHEN** a caller issues a second request to the same agent while its previous turn is still in flight
- **THEN** the request is refused with a retry-after error and the running turn is unaffected

#### Scenario: A burst over the rate limit is throttled

- **WHEN** a caller exceeds the configured request-rate bound
- **THEN** further requests are throttled with a structured rate-limit error

### Requirement: Admitted turns are metered and settled at the boundary

For every admitted external turn the facade SHALL record caller, agent, idempotency key, outcome, and duration in the facade ledger, and on completion SHALL settle the caller by duration — rounded up to whole minutes at the platform-configured rate. The turn's outcome SHALL be derived from the agent's answer on BOTH transports: a JSON-RPC error object (which the A2A transport carries with HTTP 200 — a model-failed turn answers 200 + `{error:{code,…}}`, never a non-2xx), an SSE `error` event on the streaming transport, or an unreadable/unparseable response SHALL mark the turn `outcome:"error"`; error rows are recorded but waived — no minutes billed, no settlement, no deployer share. Only an HTTP-level refusal or network failure of the agent route itself (non-2xx, unreachable) is additionally surfaced to the caller as a transport error; both classes are unbillable. Settlement SHALL elect by the caller's plan state: a caller with an active plan settles through an idempotent plan-minute drawdown recorded with settler `plan` (see serving-plans); a planless caller settles through an idempotent key balance deduction as before. Settlement failures on the deduction path SHALL retry with backoff; repeated failure or an exhausted balance SHALL suspend the caller, whose next admission is refused until the key passes the billing gate again. A deduction-path settlement that succeeds SHALL, in the same turn, credit the deployment's deployer a revenue share per the deployer-earnings capability when the turn is externally settled real money from a caller who is not the deployer.

#### Scenario: A completed turn settles exactly once

- **WHEN** an admitted turn completes
- **THEN** the caller is settled once for the minute-rounded duration at the configured rate, and the ledger records the settlement

#### Scenario: A model-failed turn carried as JSON-RPC error over HTTP 200 bills nothing

- **WHEN** an admitted message/send turn answers HTTP 200 with a JSON-RPC error object (e.g. the child's LLM upstream failed)
- **THEN** the caller receives that error response verbatim, the ledger records the turn with `outcome:"error"` and it is waived — zero minutes billed, no balance deduction, and no deployer share row is created

#### Scenario: An unreadable agent answer bills nothing

- **WHEN** an admitted turn's response body cannot be parsed as JSON-RPC
- **THEN** the ledger records `outcome:"error"` and the turn is waived

#### Scenario: Settlement failure retries then suspends

- **WHEN** the balance deduction fails transiently and keeps failing
- **THEN** the facade retries with backoff and suspends the caller after the configured threshold

#### Scenario: A suspended caller is re-admitted after the gate passes again

- **WHEN** a suspended caller's key later passes the billing gate (balance restored)
- **THEN** the caller's next request is admitted normally

#### Scenario: A plan-backed turn draws plan minutes instead of key balance

- **WHEN** a caller with an active plan completes an admitted turn
- **THEN** settlement deducts the minute-rounded duration from the plan (settler `plan`) and the caller's key balance is untouched

#### Scenario: An externally-settled turn credits the deployer's share in the same turn

- **WHEN** a planless caller who is not the deployer completes an admitted API-lane turn and the key-balance deduction succeeds
- **THEN** the deployer-earnings ledger records the share for that usage row and the deployer's sub2api balance is credited by `share:<usage_id>` in the same settlement pass

#### Scenario: The chat lane waives error turns by the same derivation

- **WHEN** an admitted chat-lane turn answers with a JSON-RPC error object, an SSE error event, or an unreadable body
- **THEN** the chat ledger records the turn as `outcome:"error"` and the channel settler is never invoked for it

### Requirement: Deployment bookkeeping snapshot serves resolution and change detection

The facade SHALL maintain an in-process cached snapshot of the deployment bookkeeping (the packs internal API), refreshed on a TTL with single-flight merging, indexed by slug for O(1) resolution. When the source is unreachable the last snapshot SHALL be served stale (matching the registry-entry snapshot's semantics); staleness beyond a hard window (5 minutes) SHALL degrade to the explicit source-unavailable error rather than serving an indefinitely stale catalog. Snapshot refreshes SHALL compute the deployment diff (added/removed/changed) via an exported pure function, so the fleet observer's bookkeeping-change detector (fd-wanxing program slice ③) reuses the same logic by minimal copy until the facade extraction converges it.

#### Scenario: Source hiccup serves stale

- **WHEN** a refresh attempt fails within the hard staleness window
- **THEN** resolution and the catalog continue serving the last snapshot without error

#### Scenario: Hard staleness degrades explicitly

- **WHEN** the snapshot has been unreachable for longer than the hard window
- **THEN** catalog and card routes respond with the explicit source-unavailable error instead of a stale list

#### Scenario: Diff detects bookkeeping changes

- **WHEN** a refresh observes deployments added, removed, or changed versus the previous snapshot
- **THEN** the exported diff function reports exactly those three buckets, and an unchanged refresh reports all three empty

#### Scenario: The deployment snapshot and the registry-entry snapshot are independent

- **WHEN** the deployment bookkeeping snapshot is fresh but the registry-entry snapshot cannot be refreshed
- **THEN** enumeration still uses the last-known registry entries, and the two snapshots' staleness do not substitute for one another

### Requirement: The facade runs as an independent Wanxing-plane deployment unit

The facade SHALL run as its own process/image (no Yizuo-gateway mounting), exposing its public routes at the Wanxing domain and a `/healthz` liveness endpoint. Its configuration SHALL be env-only with the same names as the gateway-mounted era (`SUB2API_BASE_URL`, `SUB2API_ADMIN_KEY`, `AGENT_SERVING_REGISTRY_URL`, `AGENT_SERVING_REGISTRY_TOKEN`, `AGENT_SERVING_BACKEND_TOKEN`, `PACKS_INTERNAL_BASE_URL`, `FLEET_OBSERVER_URL`, `FLEET_OBSERVER_TOKEN`), so deployment values move over mechanically. Sibling-plane access (Qianmian registry and packs internal API, sub2api) SHALL be HTTP-only via those envs. Login-scoped management routes (the caller-allowlist trio) SHALL be absent from this unit — the deployer product surface rebuilds them (slice ⑤); the allowlist store and admission checks remain.

#### Scenario: standalone boot serves the public face

- **WHEN** the facade image starts with its env set and receives an unauthenticated catalog request at its own origin
- **THEN** public agents are listed and `/healthz` answers ok, with no Yizuo gateway in the path

#### Scenario: ops usage view admits the service credential only

- **WHEN** the ops usage endpoint receives a request bearing the fleet service credential (no user session exists in this unit)
- **THEN** it answers; a request without the credential is refused

### Requirement: Console session endpoints proxy token refresh and revocation

The facade SHALL proxy the tenant OIDC token lifecycle for the console's public client: `POST /api/wanxing/v1/console/auth/refresh` accepts `{ refresh_token }`, exchanges it at the tenant token endpoint (`grant_type=refresh_token`), verifies the returned id_token under the same fail-closed gate as login (JWKS/ES384, issuer/audience/expiry, email allowlist), and returns `{ id_token, refresh_token, email }` — rotation-aware: whichever refresh token the tenant issued is the one returned. `POST /api/wanxing/v1/console/auth/revoke` accepts `{ token }` and best-effort revokes it at the tenant revocation endpoint (`/oidc/token/revocation`), responding ok regardless of upstream outcome (RFC 7009 semantics — revocation is cleanup, never a gate). Both endpoints exist only when Logto is configured; otherwise they respond 503.

#### Scenario: refresh rotates and re-verifies

- **WHEN** a valid refresh token is posted to the refresh proxy
- **THEN** the facade verifies the newly issued id_token against the allowlist and returns the new token pair with the caller's email

#### Scenario: refused identity on refresh

- **WHEN** the refreshed id_token fails verification or the allowlist
- **THEN** the refresh proxy responds 403 and returns no tokens

#### Scenario: revoke is best-effort

- **WHEN** a token is posted to the revoke proxy and the tenant is slow or unreachable
- **THEN** the facade still responds ok (the client clears local state regardless)

#### Scenario: unconfigured deployment

- **WHEN** Logto identity is not configured
- **THEN** both endpoints respond 503 and the legacy exchange/config routes stay absent

### Requirement: Fleet reads pass through the facade under the console gate

The browser-facing fleet observation reads — `GET /api/fleet/v1/board` and `GET /api/fleet/v1/agents/:slug/timeline` — SHALL be served by the facade behind the same dual gate as the console management routes (ops service token, or a verified Logto identity with fail-closed email allowlist). Admitted requests SHALL be forwarded to the observer (`FLEET_OBSERVER_URL`) with the observer service credential (`FLEET_OBSERVER_TOKEN`) as bearer, response status and body passed through. The web face's nginx SHALL route `/api/fleet/` to the facade (not the observer). The observer itself SHALL stay credential-only and unchanged — runners posting `/ingest` and ops-consumers reading the observer directly are unaffected.

#### Scenario: identity holder reads the board

- **WHEN** a caller with a verified allowlisted Logto identity requests `/api/fleet/v1/board` through the web face
- **THEN** the facade admits the request, forwards it with the observer service credential, and the board payload renders

#### Scenario: service credential still accepted

- **WHEN** the ops service token is presented to a fleet read
- **THEN** the facade admits and forwards it the same way

#### Scenario: unauthenticated fleet read

- **WHEN** a fleet read arrives with neither a service token nor a verified identity
- **THEN** the facade responds 401 before contacting the observer

#### Scenario: observer unreachable

- **WHEN** an admitted fleet read cannot reach the observer
- **THEN** the facade responds 502 with a diagnostic error, not the observer's credential challenge

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

The public catalog and agent card summaries SHALL carry a chatability marker derived from the chatability gate, served from the cached snapshot with the snapshot's freshness semantics; the marker SHALL NOT leak private agents or allowance amounts. The marker SHALL use the deployment's real pause state as an input to that gate — a paused deployment SHALL NOT be marked chatable, and the catalog MUST NOT substitute a constant for that input.

#### Scenario: The catalog marks chatable agents

- **WHEN** the catalog lists public agents and one of them is chatable
- **THEN** that entry carries the chatability marker and non-chatable entries do not

#### Scenario: The marker leaks nothing beyond the boolean

- **WHEN** an anonymous party reads the catalog or a card
- **THEN** the entry exposes the chatability boolean only — no allowance amounts, no subsidy state beyond it, no private agents

#### Scenario: A paused deployment is not advertised as chatable

- **WHEN** an agent is paused while remaining publicly listed
- **THEN** its catalog entry carries no chatability marker, so a directory face never sends a visitor into a chat page that will refuse the turn

### Requirement: Cards and catalog carry declared example prompts

公开卡（agent-card.json）与目录行 SHALL 在 registry 卡片声明 `examples` 时原样携带该字段（≤3 条示例问句）；未声明时两个面的形状 SHALL 与增补前逐字节一致。对话页 SHALL 支持 `?q=` 深链一次性预填输入框——只预填不自动发送。

#### Scenario: A declared example reaches the catalog and prefills chat

- **WHEN** 一个可对话 agent 的卡片声明两条示例
- **THEN** 目录卡片展示两条「试问」，点击跳转对话页且输入框已预填该示例、未自动发送

#### Scenario: Undeclared examples change nothing

- **WHEN** 卡片未声明 examples
- **THEN** 卡与目录行无该字段，形状与增补前一致

#### Scenario: A non-chatable agent's examples stay informational

- **WHEN** 未开放访客对话的 agent 声明示例
- **THEN** 示例只读展示并提示未开放，不产生对话跳转

### Requirement: The facade speaks to the facet packs surface as the verified console identity

facade SHALL 经转发身份通道（facet 内部凭据 + `x-facet-user` 携 console 身份）调 facet 的 packs 公面；通道未配置（env 缺任一键）时自助面 SHALL 显式降级（503 + 指引文案），绝不静默空列表。转发请求 SHALL 不携带 facet 内部凭据以外的任何服务凭据。

#### Scenario: The channel is configured and forwards identity

- **WHEN** 已配置通道且已验证身份的 console 用户请求自助面
- **THEN** facet 收到的调用带该用户身份，作者过滤返回其本人的 pack

#### Scenario: Unconfigured degrades visibly

- **WHEN** 通道未配置时请求自助面
- **THEN** 503 与明确的配置指引，面板显示降级态而非空成功

### Requirement: Deployers list their own deployable packs

`GET /console/my/packs` SHALL 以验证身份解析作者，返回其名下已发布 pack 的概要列表：pack id/名称/最新版本/可见性/是否含 serving 契约 agent（可部署性）/既部署 slug（若有）。列表 SHALL 只含本人作品；无 facet 记录时 SHALL 为空数组。

#### Scenario: The author sees only their packs

- **WHEN** 部署者请求 my/packs
- **THEN** 返回的每个 pack 的作者都是该身份，含可部署性与最新版本

#### Scenario: Nothing published reads empty, not missing

- **WHEN** 身份名下无已发布 pack
- **THEN** 返回空数组与 200

### Requirement: A deployer deploys their own pack through the facade

`POST /console/my/packs/:id/deploy` SHALL 校验：pack 属于该身份（否则 404）、body 携 billing key（serving 部署硬要求，缺失 400 指引）、版本缺省为最新。请求 SHALL 以同身份转发 facet deploy 端点并透传其结构化错误（如余额门/模型道校验失败）；成功 SHALL 返回部署结果与 agent slug。billing key SHALL 仅入部署引用，响应与日志不回显。

The body MAY carry the wizard payload: `agents` (a non-empty array of serving agent ids selecting the subset to deploy), and per-agent initial service config — `models`, `budgets`, `rhythms` mapping agent id to the deploy-time value. The facade SHALL forward `agents` verbatim and SHALL map the single billing key and the optional notify channel over the **selected** agents only (an omitted `agents` maps over every serving agent, exactly as before). Facet's validation is authoritative: shape errors and structured refusals (unknown agent, bad rhythm, lane rejection, …) SHALL pass through verbatim rather than being re-derived facade-side. `GET /console/my/packs` SHALL enrich each deployable agent with the serving contract's declared `modelWhitelist` when present, so wizard model inputs can hint the legal domain.

#### Scenario: A creator deploys their chat agent

- **WHEN** 部署者选最新版本、携自己的计费键提交
- **THEN** facet 完成部署，响应含 agent slug，分享卡可即刻拼出对话 URL

#### Scenario: A foreign pack is not deployable through my face

- **WHEN** 请求部署不属于该身份的 pack
- **THEN** 404，且不发生任何 facet 转发

#### Scenario: Facet refusals pass through verbatim

- **WHEN** facet 拒绝部署（如计费键无效）
- **THEN** 响应携带 facet 的结构化错误码与文案

#### Scenario: A wizard subset deploys only the checked agents

- **WHEN** 部署者携 `agents: ["alpha"]` 与按 alpha 的 models/budgets/rhythms 提交（pack 含 alpha、beta 两个 serving agent）
- **THEN** 转发给 facet 的 billingKeys/notifyChannel 只映射 alpha，`agents` 原样转发，响应只含 alpha 的部署结果与 slug

#### Scenario: The selection's refusals surface facet-side

- **WHEN** `agents` 含非 serving 的 id 或 rhythm 形状非法
- **THEN** facet 的 400（指名错误项）透传给向导，facade 不自行改写或吞掉

#### Scenario: my/packs carries the model whitelist hint

- **WHEN** 部署者请求 my/packs 且某 agent 的 serving 契约声明了 modelWhitelist
- **THEN** 该 agent 的 deployableAgents 项含此清单；未声明时该项无该字段（不伪造空数组）

### Requirement: The share card answers "where is my page"

自助面 SHALL 提供分享信息：agent slug 的完整对话 URL（`#/chat/<slug>`）、chatability 状态（公网+未暂停+瀑布可用）、部署者额度余量与配置指引。信息由既有面拼装，不新增存储。

#### Scenario: The share card reads green

- **WHEN** 部署成功的 public agent 且瀑布开着
- **THEN** 分享卡给出完整 URL 与 chatability=true，附额度配置指引

#### Scenario: Not yet chatable says why

- **WHEN** agent 私有或额度未配置
- **THEN** 分享卡如实给出不可对话的原因与对应配置入口

### Requirement: The public catalog serves server-side facets with curation and activity signals

The public catalog (`GET /agents`) SHALL support server-side filtering BEFORE pagination: `q` (case-insensitive substring over name, description, slug, and tags), `category` (exact match), and `featured=1`. A request carrying `facets=1` SHALL receive a `facets` summary block — `{ total, featured, categories: [{ name, count }] }` — computed over the UNFILTERED public list. Every catalog entry SHALL carry the curation signal — `category` (joined by pack id from the single stored curation source every directory face reads, cached; absent join degrades to no field, never a wrong one) and `featured` — plus an activity signal `turns7d` (the facade usage ledger's external turns over the last 7 days across both lanes; zero is honest zero). The facade MUST NOT derive curation independently (no heuristics from pack name, tags, or badges), and MUST NOT apply the marketplace's admission rules: here curation is a LABEL, never a filter. An operator whitelist or a curated-only admission gate on the marketplace faces MUST NOT hide, from this catalog, an agent that is deployed and public. A request with NO filter parameters SHALL return the legacy full shape byte-for-byte, apart from the additive entry fields this spec introduces (existing callers untouched).

#### Scenario: Server-side search and category filter precede pagination

- **WHEN** a caller requests `?q=法律` or `?category=legal` with paging
- **THEN** only matching public agents are returned, the page slices the FILTERED list, and `total` counts the filtered set

#### Scenario: The facets summary counts the unfiltered list

- **WHEN** a caller requests `?facets=1&category=legal`
- **THEN** the response carries `facets.categories` with counts over every public agent (not just legal ones), so a browser can render the full chip row

#### Scenario: Curation rides the catalog degraded-honestly

- **WHEN** the packs read face is unreachable or a pack row is absent
- **THEN** the catalog still serves entries; affected entries carry no `category` (they render ungrouped), and the catalog never blocks on the curation join

#### Scenario: An uncurated deployment is still listed

- **WHEN** a public agent is deployed from a pack that carries neither a category nor the featured flag
- **THEN** the agent appears in the catalog with no `category` and `featured` absent — curation filters the marketplace faces, never this one

#### Scenario: The marketplace's operator whitelist does not narrow this catalog

- **WHEN** the marketplace faces are narrowed by an operator whitelist or by curated-only admission
- **THEN** every deployed public agent still appears in this catalog, and the whitelist changes nothing here

#### Scenario: The activity signal is the usage ledger read back

- **WHEN** an agent served 12 external turns (api + chat) in the last 7 days and none before
- **THEN** its catalog entry carries `turns7d: 12`; an agent with no external turns carries `turns7d: 0`

#### Scenario: No parameters keeps the legacy shape

- **WHEN** a caller requests the catalog with no query parameters
- **THEN** the response is the legacy full-list shape with no facets block and no behavioral change beyond the additive entry fields

### Requirement: Console deployers may deploy a discovered pack greenfield

The facade SHALL expose a console-catalog pack list (`GET /console/catalog/packs`): public listed packs joined with their serving agents (deployability) and their in-service state (the deployments snapshot's pack ids), carrying the curation fields — for the deploy wizard's directory source. The self-service deploy SHALL accept a FOREIGN public pack when that pack has NO live deployment (greenfield): the forwarded identity carries the creators group for that call alone (the console allowlist is the operator-granted deployer credential; the facet's own gate still applies), and the deploy bills on the deployer's key. A foreign pack that IS deployed SHALL be refused with a 400 naming the in-service state — upgrades belong to the author's path; a takeover of someone's live deployment through this face is impossible by construction. The author's own packs keep the existing path including redeploy.

#### Scenario: The directory source lists deployable packs with their state

- **WHEN** a verified deployer opens the wizard's directory source
- **THEN** public listed packs with serving agents are listed with category, featured, and an in-service badge; packs without serving agents are absent or marked undeployable

#### Scenario: A greenfield foreign pack deploys on the deployer's key

- **WHEN** a verified deployer deploys a public pack that has no live deployment, providing their billing key
- **THEN** the facade forwards the deploy with the creators group attached to the identity, the deployment bills on the deployer's key, and the deployed agent appears in the catalog

#### Scenario: An in-service foreign pack refuses

- **WHEN** a verified deployer attempts to deploy a foreign pack whose agents are already deployed
- **THEN** the facade refuses with a 400 naming the in-service state and pointing upgrades to the author path, and no facet deploy is forwarded

#### Scenario: The author's redeploy path is unchanged

- **WHEN** the pack's author deploys their own in-service pack through my/packs
- **THEN** the existing semantics apply verbatim — no creators-group bridging, no greenfield restriction

### Requirement: Deployers organize packs into collections

The facade SHALL persist collections — `{id, owner, name, description, visibility, entries, timestamps}` — one table, entries a JSON list of `{packId, agentId?, suggestedConfig?}` references (no content copies; the pack stays the atomic supply unit). Console-verified owners SHALL create, rename, describe, toggle visibility, and delete their collections, and SHALL replace the whole entry list in one write (≤20 entries, no duplicate packId+agentId, suggestedConfig limited to `{model?, budgetMinutes?, rhythm?}` with cheap shape guards — the facet remains the validation authority at deploy time). Foreign PRIVATE collections SHALL answer 404 on every face. The collection detail SHALL resolve each entry against the cached pack browse (name, version, curation, in-service state) and the cached serving-agent summary (agent name), degrading honestly when a pack row is absent.

#### Scenario: A deployer curates a private grouping

- **WHEN** a verified deployer creates a collection, adds entries from their packs and the directory, and keeps it private
- **THEN** the collection lists only for its owner, and its entries resolve to pack names, versions, and in-service badges

#### Scenario: Entry writes are whole-list and shape-guarded

- **WHEN** an entry-list write carries a duplicate packId+agentId, a non-object suggestedConfig, or more than 20 entries
- **THEN** the write is refused with a 400 naming the rule, and the stored list is unchanged

#### Scenario: Foreign private collections do not exist

- **WHEN** anyone but the owner requests a private collection on any face
- **THEN** the answer is 404 — probing teaches nothing

### Requirement: A public collection deploys as a bundle on the deployer's key

A public collection SHALL be readable without credential at its share face (`GET /collections/:id`) — entries resolved, no owner email leaked — and deployable by ANY verified console identity through `POST /console/collections/:id/deploy` (the owner may deploy a private one). The deploy SHALL take the deployer's billing key (required) and an optional notify channel, iterate the entries sequentially through the self-service deploy core — each entry riding its agentId as the deploy subset and its suggestedConfig as the deploy-time config — and SHALL report a per-entry verdict: `deployed` (with slug), `skipped-in-service` (an in-service pack never blocks the rest), `refused`, or `error` (the facet's structured refusal passes through verbatim). A collection SHALL NOT carry execution semantics — it is a reference list plus deploy-time suggestions only; nothing schedules, runs, or monitors.

#### Scenario: One-click bundle deploy bills once per deployer

- **WHEN** a deployer submits a billing key for a three-entry public bundle (one own pack, one greenfield foreign pack, one in-service foreign pack)
- **THEN** the first two deploy on the deployer's key with their suggested configs riding the payloads, the third reports skipped-in-service, and the response carries three per-entry verdicts

#### Scenario: suggestedConfig rides the payload and stays advisory

- **WHEN** an entry declares `{budgetMinutes: 10, rhythm: [{"every":"1h"}]}` and the deploy succeeds
- **THEN** the forwarded deploy body carries the budget and rhythm for that agent; the facet's validation is the only gate

#### Scenario: A structured refusal surfaces per entry without aborting the bundle

- **WHEN** one entry's deploy is refused by the facet (e.g. lane rejection)
- **THEN** that entry reports refused with the facet's error text, and the remaining entries still deploy

#### Scenario: The share face serves public collections only

- **WHEN** an anonymous visitor opens a public collection's share URL
- **THEN** the bundle renders with resolved entries; a private collection's URL answers 404

### Requirement: The fleet summary aggregates usage and allowance per agent

The facade SHALL serve a fleet summary (`GET /fleet/summary`, verified identity) composed only from the facade's own store — one pass over the usage ledger keyed by agent slug (turns over the trailing 7 days across both lanes; minutes and settled-value over the trailing 30 days, waived turns excluded from value) plus every host allowance's limit and remaining minutes. The summary SHALL make no registry or external call (the deployments list's registry enrichment joins client-side) and an unreachable anything SHALL never degrade it — it is store-local by construction.

#### Scenario: One call answers the cockpit's three questions

- **WHEN** a verified deployer fetches the fleet summary
- **THEN** each slug carries turns7d, minutes30d, usd30d, and its allowance's limit/remaining (or no allowance key when unset) — enough to render health, activity, and cost watermarks without another call

#### Scenario: Zero activity reads as honest zero

- **WHEN** an agent has no usage rows in the windows
- **THEN** its summary entry reads zero turns/minutes/usd, not absent

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

### Requirement: Streamed chat turns relay serving asks and bind them to the visitor

The chat turn surface SHALL mark every streamed turn (`message/stream`) as ask-capable toward the serving plane, SHALL relay the upstream stream byte-verbatim including `ask` events and keepalive comment frames, and SHALL record each relayed ask — its id, the admitted visitor's subject, the agent, and the ask's deadline — for the ask's window so that only that visitor may answer it. Synchronous turns (`message/send`) SHALL NOT be marked ask-capable. The public embed configuration SHALL advertise that the lane carries asks (`features.asks`).

#### Scenario: An ask reaches the widget unchanged

- **WHEN** the upstream stream emits an `ask` event during a streamed turn
- **THEN** the same event bytes reach the caller, the stream stays open, and the facade has recorded the ask id under the calling visitor and agent

#### Scenario: Keepalive frames pass through

- **WHEN** the upstream stream emits SSE comment frames while an ask is pending
- **THEN** they reach the caller unchanged and the facade's turn accounting is unaffected

#### Scenario: Synchronous turns do not opt in

- **WHEN** a caller uses `message/send`
- **THEN** the upstream request carries no ask-capable marker and any ask the agent raises is declined upstream without the facade's involvement

#### Scenario: Embed configuration advertises asks

- **WHEN** a host fetches an agent's embed configuration
- **THEN** it includes `features.asks` set to true

### Requirement: Ask answers ride an authenticated side route bound to the asking visitor

The chat surface SHALL accept `POST /api/wanxing/v1/chat/:agentSlug/ask-answer` with `{askId, answers}` or `{askId, cancelled: true}` under the same visitor authentication, cross-slug anonymous refusal, and chat-lane rate bound as a turn. An ask id that is unknown, expired, recorded under a different visitor, or recorded under a different agent SHALL be refused with a structured not-found error and nothing is forwarded. An accepted submission SHALL be forwarded to the agent's serving route and the serving plane's receipt (`{accepted: true|false, reason?}`) SHALL be returned as-is; the route SHALL NOT meter or settle minutes — the answered turn is already metered by its stream.

#### Scenario: The asking visitor answers

- **WHEN** the visitor who holds the streamed turn posts answers for its pending ask id
- **THEN** the facade forwards them to the agent and returns `{accepted: true}`

#### Scenario: A cancel resolves the ask

- **WHEN** the asking visitor posts `{askId, cancelled: true}`
- **THEN** the facade forwards the cancel and returns the serving plane's receipt

#### Scenario: Another visitor cannot answer

- **WHEN** a different authenticated visitor posts an answer for that ask id
- **THEN** the response is a structured not-found error and nothing reaches the agent

#### Scenario: An unknown or expired ask id is refused

- **WHEN** an answer arrives for an ask id the facade never relayed, or whose deadline has passed
- **THEN** the response is a structured not-found error and nothing reaches the agent

#### Scenario: A late duplicate yields the upstream receipt

- **WHEN** a second answer arrives for an ask already resolved upstream
- **THEN** the facade returns the serving plane's `{accepted: false}` receipt unchanged

#### Scenario: Answers are not metered

- **WHEN** an answer is accepted
- **THEN** no new usage row, slot, or settlement is created for it

### Requirement: Catalog entries and cards carry the cluster marker

The facade SHALL maintain a cluster index derived from the facet packs surface: for every public listed pack whose browse row reports more than one agent (`agentCount > 1`), the pack detail SHALL be fetched on the catalog signals' cadence, cached and keyed by pack id plus version (a republish refreshes it), and the pack SHALL enter the index ONLY when its manifest declares a `cluster` block — the declared `name`, `description`, `defaultAgents`, `optionalAgents` and the declared member count. A multi-agent pack without a `cluster` declaration SHALL NOT group: the author's declaration is the team signal, matching the Yizuo catalog's rule. Every public catalog entry and every agent card whose deployment belongs to an indexed pack SHALL carry an additive `cluster` marker — `{ id, name, role, members }` where `id` is the pack id, `role` is `default` when the deployment's agent id is in `defaultAgents` and `optional` otherwise, and `members` is the declared member count. Entries from packs without a declaration SHALL carry no `cluster` field, and a catalog without cluster-pack deployments SHALL answer exactly as before. A detail fetch that fails SHALL degrade to the last-known index — an unknown pack renders ungrouped — and the catalog SHALL never block on the cluster join.

#### Scenario: Members of a declared cluster carry the marker

- **WHEN** a pack declaring `cluster` (defaultAgents `a`, `b`; optionalAgents `c`) has agents `a` and `c` deployed and public
- **THEN** the catalog entries for `a` and `c` both carry `cluster: { id: <packId>, name, role, members: 3 }` with `a`'s role `default` and `c`'s role `optional`, and their agent cards carry the same marker

#### Scenario: A multi-agent pack without a declaration stays flat

- **WHEN** a two-agent pack with no `cluster` block has both agents deployed
- **THEN** neither entry carries a `cluster` field

#### Scenario: Detail failure degrades to the last-known index

- **WHEN** the pack detail fetch fails during an index refresh
- **THEN** the catalog still answers; entries of packs known from the previous index keep their marker, and packs never indexed render ungrouped

#### Scenario: A republish refreshes the index

- **WHEN** a cluster pack publishes a new version whose `cluster` block changed
- **THEN** the next refresh re-reads the detail under the new version key and the marker reflects the new declaration

### Requirement: The catalog filters by cluster and counts clusters in the facets summary

`GET /agents` SHALL accept `cluster=<packId>` as a server-side filter applied BEFORE pagination — an entry matches when its `cluster.id` equals the value — combinable with the existing `q`, `category` and `featured` filters. The `facets` summary SHALL additionally carry `clusters`: the number of distinct cluster ids over the UNFILTERED public list. A request without the `cluster` parameter SHALL behave exactly as before.

#### Scenario: Cluster filter precedes pagination

- **WHEN** a caller requests `?cluster=<packId>&page=1&page_size=1` and that cluster has two public members
- **THEN** only those two members are candidates, the page carries one of them, and `total` is 2

#### Scenario: The facets summary counts clusters over the unfiltered list

- **WHEN** a caller requests `?facets=1&category=docs` while two distinct cluster packs have public members, neither in `docs`
- **THEN** `facets.clusters` is 2 regardless of the category filter

### Requirement: Self-service pack lists carry the cluster declaration

`GET /console/my/packs` and `GET /console/catalog/packs` SHALL carry, for every pack whose manifest declares `cluster`, an additive `cluster: { name, description, defaultAgents, optionalAgents }` read from the same detail fetch that yields `deployableAgents`; packs without the declaration SHALL carry no `cluster` field. The declaration is informational for the wizard: deployability SHALL stay defined by `agents[].serving` exactly as before, so a cluster member without a serving contract is still not deployable.

#### Scenario: A cluster pack's rows carry the declaration

- **WHEN** a deployer lists my/packs or the directory source and a pack declares `cluster`
- **THEN** that pack's row carries `cluster` with the declared name, description, defaultAgents and optionalAgents alongside its unchanged `deployableAgents`

#### Scenario: Declaration does not imply deployability

- **WHEN** a cluster pack's members carry no `serving` contract
- **THEN** the row carries the `cluster` declaration while `deployableAgents` is empty and `deployable` is false

### Requirement: A served cluster is addressable as one A2A unit

A pack that declares `cluster` and has at least one of its `defaultAgents` deployed SHALL be served as a cluster unit at `slug = slugFor(packId)` under its own route family `/api/wanxing/v1/a2a/cluster/:clusterSlug`, disjoint from the per-agent routes by path shape. The facade SHALL list units publicly at `GET /api/wanxing/v1/clusters` — `{ clusters: [{ slug, id, name, description, policy, members: [{ id, name, role, served, slug? }], url }] }` — and SHALL serve each unit's card at `/.well-known/agent-card.json` without credential: name and description from the declaration, `capabilities.streaming: false`, one `skills` entry per served public member (`id` = agent id, `name`, `description`, `tags` naming the role), the unit's route as `url`, and a `cluster` extension block naming members, roles, the scheduling policy and the supported aggregations. Units and cards SHALL be derived from the cluster index and the deployment snapshot — nothing persisted — and SHALL hard-degrade with the snapshot exactly as the agent catalog does. A unit whose served members are all private SHALL be absent from the public list and its card SHALL answer not-found; a mixed unit SHALL list its public members only.

#### Scenario: A partial team is listed honestly

- **WHEN** a pack declares defaults `a`, `b` and optional `c`, and only `a` and `c` are deployed and public
- **THEN** the unit is listed with members `a` (served, slug) , `b` (served false, no slug) and `c` (served, slug), and its card's `skills` name `a` and `c` only

#### Scenario: No default member served, no unit

- **WHEN** only the optional member `c` is deployed
- **THEN** the unit is absent from `/clusters`, and its card and route answer `CLUSTER_NOT_FOUND`

#### Scenario: The card is public and points at the facade

- **WHEN** an unauthenticated party fetches a listed unit's card
- **THEN** it answers with `url` on the facade's cluster route, `capabilities.streaming: false`, and the `cluster` block naming members, roles, policy and aggregations

### Requirement: A cluster turn fans out to admitted members and aggregates by policy

`POST /api/wanxing/v1/a2a/cluster/:clusterSlug` SHALL accept JSON-RPC `message/send` only — `message/stream` and every other method answer the protocol's method-not-found error naming the send-only contract — SHALL authenticate the caller by key exactly as the per-agent door, SHALL charge ONE rate-limit tick and apply the plan gate ONCE, and SHALL hold one (caller, unit) in-flight slot (a concurrent second composite refuses with the retry-after error). The member set SHALL be the unit's served default members unless `params.message.metadata.agents` names a subset of served members; an unknown or unserved id SHALL refuse with an invalid-params error naming it. Each selected member SHALL be admitted individually by the agent admission rules (paused, private allowlist) and SHALL additionally be marked `skipped` when its (caller, member) slot is held; a turn with no admitted member SHALL refuse with a structured error listing every member's reason and SHALL run nothing. Admitted members SHALL run concurrently up to the declaration's `schedulingPolicy.maxConcurrentRuns` (absent: every admitted member at once), each bounded by the configured member timeout (`WANXING_CLUSTER_MEMBER_TIMEOUT_MS`, default 300000) and each on a member context derived from the unit's context (`<context>--<agentId>`, keeping the external prefix) so a caller-supplied `context_id` continues every member's conversation. Aggregation SHALL follow `params.message.metadata.aggregation`: `all` (default — every successful member's text as a section labeled with the member's name, failed and skipped members footnoted with their reasons), `first` (the first member to succeed; the others complete and bill as usual), or `summary` (one additional turn on the first successful default member in declaration order, fed every successful output, whose answer becomes the text; a failed synthesis, or no successful default member, falls back to `all` with the fallback noted). The response SHALL be a single A2A message whose `metadata.cluster` block reports `{ id, slug, aggregation, members: [{ id, slug, status, reason?, durationMs?, minutesBilled? }], summaryBy? }` with `status` one of `ok`, `error`, `skipped`; when every admitted member errors, the response SHALL be a JSON-RPC error (`CLUSTER_ALL_FAILED`) still carrying the block.

#### Scenario: The default fan-out aggregates every member

- **WHEN** an admitted caller sends a text with no metadata to a unit whose defaults `a` and `b` are served, and both answer
- **THEN** the result text carries two sections labeled with `a`'s and `b`'s names, and `metadata.cluster.members` reports both `ok`

#### Scenario: A subset runs and a summary leads

- **WHEN** the caller names `metadata.agents: ["a", "c"]` with `aggregation: "summary"` and both succeed
- **THEN** `a` and `c` run, one synthesis turn runs on `a` (the first successful default member in declaration order), the result text is the synthesis, and `summaryBy` is `a`

#### Scenario: A paused member is skipped, not fatal

- **WHEN** member `b` is paused while `a` is admitted
- **THEN** `a` runs, `b` reports `skipped` with reason `AGENT_PAUSED`, and the response is a successful message

#### Scenario: Nothing admitted refuses before any turn

- **WHEN** every selected member is paused or not authorized for the caller
- **THEN** the composite refuses with a structured error listing each member's reason, and no member route is called

#### Scenario: Concurrency follows the declaration

- **WHEN** the declaration sets `maxConcurrentRuns: 1` and two members are admitted
- **THEN** the second member starts only after the first finished; with no declared policy both start at once

#### Scenario: Streaming is refused

- **WHEN** the caller invokes `message/stream` on a unit
- **THEN** a method-not-found error names the send-only contract and no member turn runs

#### Scenario: Member errors are footnoted, total failure is an error

- **WHEN** `a` answers a JSON-RPC error and `b` answers text under `all`
- **THEN** the text carries `b`'s section with `a` footnoted as failed and `a` reports `error`; when both error, the response is the `CLUSTER_ALL_FAILED` JSON-RPC error carrying the block

### Requirement: Cluster member turns are metered and settled individually

Every member turn of a cluster turn, and the summary turn, SHALL be recorded and settled as its own admitted turn through the existing kernel: its own (caller, member) slot, its own usage row — `agent_slug` the member's slug, `idem_key` the caller's Idempotency-Key suffixed `--<agentId>` (or `--summary`), and `cluster_turn_id` linking every row of one cluster turn — its own outcome derivation (a member's JSON-RPC error, unreadable answer or timeout is `outcome:"error"` and waived), and settlement by the caller's plan state, deployer share, completion callback and fleet events exactly as a direct turn. The unit itself SHALL record no usage row and bill nothing. The composite SHALL deduplicate on the caller's Idempotency-Key scoped (caller, unit): a replay SHALL return the recorded composite response without running any member, and a composite interrupted mid-flight SHALL, on replay, reuse its finished members' recorded outcomes through their derived keys and rerun only the unfinished ones.

#### Scenario: Three rows share one cluster turn id, none for the unit

- **WHEN** a cluster turn runs members `a` and `b` under `summary` and completes
- **THEN** the ledger holds three usage rows (`a`, `b`, and the lead's summary) with one shared `cluster_turn_id`, and no row names the unit's slug

#### Scenario: A failed member is waived inside a successful turn

- **WHEN** `a` errors and `b` succeeds
- **THEN** `a`'s row is `outcome:"error"` with zero minutes and `b`'s row bills its minutes

#### Scenario: A composite replay runs nothing

- **WHEN** the same (caller, unit, Idempotency-Key) is replayed after completion
- **THEN** the recorded composite response is returned and no new usage row is written

#### Scenario: A partial crash replays finished members

- **WHEN** `a` finished and `b`'s flight was lost before the composite recorded, and the caller replays the same key
- **THEN** `a`'s outcome replays from `<key>--a` without a new row and only `b` reruns

### Requirement: The cluster marker names the unit's endpoint when the unit is listed

When a cluster unit is listed, every catalog entry and agent card carrying that cluster's marker SHALL additionally carry `cluster.slug` (the unit's slug) and `cluster.url` (the unit's route); when the unit is not listed (no default member served) the marker SHALL carry neither field.

#### Scenario: Marker gains the endpoint

- **WHEN** a default member of the cluster is served
- **THEN** every member entry's marker carries `slug` and `url` resolving to the unit's route

#### Scenario: Marker without a unit

- **WHEN** only optional members are served
- **THEN** member entries carry the marker without `slug` or `url`

### Requirement: Deployment memory proxies the fleet visibility lane under the owner gate

The console SHALL expose per-deployment memory faces that proxy fd-memory's platform-seam visibility lane: `GET /api/wanxing/v1/console/deployments/:slug/memory` (query: `layer` L0|L1|L2, `scope` project name, `since`/`until`, `limit`/`offset`) forwards to the fleet memory `GET /memory` with `rootKey=d-<packId>` resolved from the deployment's bookkeeping row; `POST /api/wanxing/v1/console/deployments/:slug/memory/forget` accepts `{ path, confirm }` and forwards to `POST /forget` with the same rootKey. Both faces SHALL sit behind the same owner gate as pause/resume (deployer-of-record or ops credential), and the forwarded rootKey MUST derive from that verified row — a caller MUST NOT be able to name an arbitrary root. The lane SHALL exist only when the fleet-memory platform seam is configured (`FD_MEMORY_URL` + `FD_MEMORY_PLATFORM_TOKEN`); unconfigured deployments respond 503 with a stable code, and fleet-memory unreachability degrades visibly (503 naming the lane), never as an empty list.

#### Scenario: deployer reads own deployment memory

- **WHEN** the deployer of record requests their deployment's memory with `layer=L2`
- **THEN** the facade forwards with `rootKey=d-<packId>` of that deployment and returns the fleet memory items verbatim

#### Scenario: non-deployer is refused before any forward

- **WHEN** a verified identity that did not deploy the slug requests its memory
- **THEN** the owner gate refuses 403 and no fleet-memory call is made

#### Scenario: unconfigured or unreachable lane degrades visibly

- **WHEN** the fleet-memory seam is unconfigured, or fleet-memory is unreachable
- **THEN** the proxy responds 503 with a stable error code (never an empty list), and the console renders an explicit degraded state

### Requirement: The chat lane injects the signed-in visitor's own memory digest

The facade chat lane SHALL read the tenant's memory digest face before a turn and append it to the prompt: a signed-in visitor (`tier=tenant`, carrying an email) SHALL be answered with the digest of their OWN owner root (`project=default`), while an anonymous visitor (`tier=anon`) SHALL receive no memory and MUST NOT cause any memory request. Injection SHALL apply to both `message/send` and `message/stream`. The query SHALL be the visitor's own message, never the conversation transcript.

#### Scenario: A signed-in visitor's turn carries their own digest

- **WHEN** a visitor with a verified tenant identity sends a chat message
- **THEN** the prompt sent upstream is the visitor's message followed by the digest block of their own root
- **AND** the memory read names the visitor's own owner namespace, not the deployment's

#### Scenario: An anonymous visitor never touches memory

- **WHEN** an anonymous visitor (ephemeral credential) sends a chat message
- **THEN** the prompt is byte-identical to the memory-off baseline
- **AND** no memory service request is issued

### Requirement: Memory is read through one switch and degrades open

The lane SHALL be controlled by a single switch (`WANXING_FACADE_MEMORY_DIGEST=0` disables it entirely) and SHALL be inert when memory credentials are absent. Any failure — mint failure, non-2xx digest response, timeout, malformed body — MUST leave the turn byte-identical to the memory-off baseline and MUST NOT fail the turn.

#### Scenario: The kill switch issues zero requests

- **WHEN** `WANXING_FACADE_MEMORY_DIGEST=0`
- **THEN** no memory request is made and the prompt is unchanged

#### Scenario: A memory failure still answers the turn

- **WHEN** the memory service is unreachable or exceeds the read deadline
- **THEN** the turn proceeds with the original text and the failure is logged once

### Requirement: Public agent cards redact non-public provider endpoints

The facade SHALL serialize `provider` in public agent cards through a
redactor: when `provider.url` denotes a non-publicly-routable address
(RFC1918 private ranges, CGNAT 10.0.0.0/10, loopback, link-local,
`0.0.0.0`, single-label hostnames, or cluster-internal suffixes `.svc`,
`.cluster.local`, `.local`, `.internal`) or cannot be parsed as a URL, the
card MUST omit the `url` key from `provider`. Publicly-routable provider
URLs and all other provider fields (e.g. `organization`) MUST be preserved
unchanged. Absent-provider fallback MUST keep its current shape. The
redaction applies at the serialization boundary only; the underlying
deploy entry / registry snapshot MUST NOT be rewritten by this path.

#### Scenario: internal runner address is stripped from the public card

WHEN a deployed agent's entry carries `provider.url` pointing at a tailnet or other private address (e.g. `http://10.0.0.10`)
THEN `GET /.well-known/agent-card.json` returns a provider object without a `url` key, `organization` and other fields intact

#### Scenario: public provider URL passes through verbatim

WHEN `provider.url` is a publicly-routable address (e.g. `https://mcp.finddatatech.cloud`)
THEN the agent card includes that `url` unchanged

#### Scenario: unparseable URL fails closed

WHEN `provider.url` is present but not parseable as a URL
THEN the agent card omits the `url` key

### Requirement: The public catalog excludes retired and internal acceptance agents

The public catalog SHALL only present agents that are currently deployed and servable; retired deployments and internal acceptance/verification agents (deployment or pack marked non-public / retired in the ledger) SHALL NOT render in the catalog, their cards, or facet counts. Exclusion rides the ledger state — the facade adds no hand-maintained blocklist.

#### Scenario: An acceptance agent is retired

- **WHEN** an acceptance deployment is retired (or its pack made private) in the ledger
- **THEN** it disappears from the catalog, facets counts, and cluster groups on the next snapshot refresh, with no code change

#### Scenario: The catalog never renders iteration codenames

- **WHEN** a visitor browses the public catalog
- **THEN** no entry's name or description carries internal acceptance markers (iteration codes, 验收 labels)

### Requirement: The facade serves a curated public status endpoint

The facade SHALL serve a read-only public status endpoint returning curated aggregates only — catalog size, 7-day external turns, settlement pending count/usd — computed from existing ledgers, with cache headers suitable for a footer strip; it MUST NOT expose internal addresses, tokens, per-caller data, or the deep health report.

#### Scenario: Anonymous status probe

- **WHEN** the status endpoint is requested without credentials
- **THEN** it returns the curated aggregate set with 200 and cache headers, leaking nothing internal

#### Scenario: Ledger partially unavailable

- **WHEN** a source aggregate is temporarily unavailable
- **THEN** that aggregate is reported as stale/null while the rest serve — the endpoint never 500s the whole payload

### Requirement: The facade redacts paused agents from admission consistently

An agent paused or retired mid-window SHALL be refused at admission with the structured not-found/paused error it already uses, so the catalog, chat lane, and A2A lane agree on what is servable at any instant.

#### Scenario: Turn against a retired agent

- **WHEN** a caller sends a chat or A2A turn to an agent retired after its card was cached client-side
- **THEN** admission refuses with the existing paused/not-found structured error and no turn is metered

### Requirement: 台账辅助行有保留策略

`wanxing_requests` 幂等行与 `wanxing_mission_writebacks` SHALL 按保留窗清理（env 可调，默认覆盖幂等/回写语义所需窗口），`wanxing_usage` 等账本行 SHALL 长存不受清理影响；`callback-audit.jsonl` SHALL 按日轮转并限量（保留 N 天，默认 14），轮转文件可查。

#### Scenario: 幂等行不无限增长

- **WHEN** 幂等行超过保留窗
- **THEN** 清理任务删除旧行，重放该 key 得到「未知 key」语义（可开新回合），账本 usage 行不受影响

#### Scenario: 审计文件可追溯且不失控

- **WHEN** callback 审计跨天写入
- **THEN** 按日开新文件，超保留期的轮转文件被清理，磁盘占用有界

#### Scenario: 账本永不被清

- **WHEN** 清理任务执行
- **THEN** `wanxing_usage`（结算/计费事实源）行数只增不减

### Requirement: The facade serves deployment management routes in slug addressing

The facade SHALL expose deployment management routes — caller allowlist list/add/remove and pause/resume — addressed by the deployment slug (the existing console routes ARE the management routes: `/api/wanxing/v1/console/deployments/:slug/...`), gated by the console credential (service token, ownerGate token path) and the deployer console gate (Logto) respectively, carrying the same ownership rules; the ops tool surface (wanxing-ops-mcp) addresses them by slug (design 1.2 conclusion).

#### Scenario: ops-mcp manages a deployment without the paas gateway

- **WHEN** wanxing-ops-mcp calls the management routes with the deployment slug and a valid credential
- **THEN** allowlist and pause/resume operations succeed against the facade directly, with responses in the same shape as the console routes

#### Scenario: Ownership rules carry over

- **WHEN** a caller without ownership or a valid gate attempts a management mutation
- **THEN** the facade refuses with the same error semantics as the console route

### Requirement: The facade is the single public A2A card face

After consumer migration, the wanxing facade SHALL be the only public serving point for agent cards and the catalog (wanxing domain and any platform-domain consumers migrated to it); the paas gateway SHALL NOT mount public wanxing A2A card routes, and `wanxing-ops-mcp` SHALL address the facade via `WANXING_OPS_BASE_URL`. Card redaction semantics SHALL be identical across domains because one implementation serves them.

#### Scenario: Platform-domain consumer migrates

- **WHEN** a consumer that previously read `/api/wanxing/v1/a2a/*` on the platform domain is switched to the wanxing domain
- **THEN** the card/catalog response is equivalent (same fields, same redaction), with no per-domain code divergence

#### Scenario: Twin maintenance ends

- **WHEN** a card-redaction or catalog change is made afterward
- **THEN** it is made in one repository only, and no twin commit on the paas side is required

### Requirement: The health endpoint reports deep dependency checks

The facade `/healthz` SHALL report readiness plus deep checks — sub2api admin self-check, registry reachability, packs internal reachability — with per-dependency status; the deep report SHALL be safe for cluster-internal consumption and MUST NOT expose internal addresses, tokens, or counts beyond status to any public surface (the public status strip uses a separate curated endpoint).

#### Scenario: A borrowed dependency hangs

- **WHEN** sub2api is unreachable and `/healthz` is probed
- **THEN** the response names that dependency degraded within the probe timeout, and the probe itself never hangs

#### Scenario: Public surface stays curated

- **WHEN** the public status endpoint is requested anonymously
- **THEN** it returns only curated aggregates (catalog size, 7-day turns, settlement pending), never the deep report internals

### Requirement: Line copilot bindings are declared in the Wanxing plane

The facade SHALL store, in its own database, a per-line binding naming which public deployment serves that line as its outward copilot, together with the line's accent and its intended visitor policy. A binding SHALL be written only through the console under the ops credential, and only when the named agent exists in the deployment bookkeeping snapshot and is a public deployment. The deployment bookkeeping of the sibling packs surface SHALL remain read-only to the facade — no binding is ever written into it. Unbinding SHALL be a first-class action and take effect on the next resolution.

A binding records **intent**; it SHALL NOT itself admit any visitor. Visitor admission continues to follow the existing gates (the platform anonymous switch AND the agent's deployer-managed anonymous setting, or a verified tenant identity). The console SHALL surface the difference between a line's intended policy and the effective one, so an unopened gate reads as a visible configuration gap rather than a silent trap.

#### Scenario: Ops binds a line to an existing public deployment

- **WHEN** the ops credential binds line `lex` to a slug present in the deployment bookkeeping snapshot and public
- **THEN** the binding is recorded in the facade's own store and the next resolution for `lex` answers with that agent

#### Scenario: Binding an agent that does not exist is refused

- **WHEN** a binding names a slug absent from the deployment bookkeeping snapshot
- **THEN** the write is refused with a structured error and no binding is recorded

#### Scenario: A binding never reaches the sibling ledger

- **WHEN** a binding is written or removed
- **THEN** no request mutating the packs deployment ledger is issued by the facade

#### Scenario: Unbinding resolves as unbound

- **WHEN** an existing binding is removed
- **THEN** the next resolution for that line answers `unbound` and no agent

### Requirement: A public endpoint resolves a line's outward copilot

The facade SHALL serve a public, credential-free read endpoint resolving a line id to its bound copilot, readable cross-origin (any embedding origin), and SHALL answer with the binding's public projection only: the line, a coarse state, the agent's public identity (slug, name, description), a theme accent, the **effective** anonymous availability, and the lane features. It SHALL NOT expose keys, tokens, quota internals, settlement identity, deployer identity, or the binding's intended-policy fields. An unknown line SHALL answer with an explicit unknown state rather than an error; a bound agent that is paused, non-chatable, or missing from bookkeeping SHALL answer with the corresponding closed state rather than a 404 that a host could mistake for success.

#### Scenario: A bound, serveable line answers ready

- **WHEN** an anonymous host fetches the resolution for a line bound to a public, chatable, unpaused agent
- **THEN** the response carries the ready state, the agent's slug/name/description, the accent, the effective anonymous availability, and the ask feature marker

#### Scenario: An unknown line is answerable, not an error

- **WHEN** a request names a line with no binding
- **THEN** the response carries the unbound state with no agent, and no secret or quota field appears

#### Scenario: A paused or vanished binding resolves closed

- **WHEN** the bound agent is paused, no longer public, no longer chatable, or absent from the bookkeeping snapshot
- **THEN** the resolution answers a closed state naming the reason, and no agent conversation is offered

#### Scenario: The projection carries no internals

- **WHEN** any resolution response is inspected
- **THEN** it contains no caller keys, settlement identity, remaining-quota numbers, or deployer email

### Requirement: Public catalog entries carry live instance status and provenance

Every entry of the public catalog (`GET /api/wanxing/v1/agents`) SHALL carry a `status` field and a `status_as_of` timestamp. `status` SHALL be exactly one of:

- `serving` — the deployment is not paused and its usage ledger shows at least one external turn (api or chat lane) in the last 7 days;
- `idle` — the deployment is not paused and its usage ledger shows zero external turns in the last 7 days;
- `paused` — the deployment bookkeeping row marks the agent paused;
- `unknown` — reserved for "no status could be derived when this entry was built". The enumeration face's hard-stale guard (the bookkeeping-snapshot requirement) fires first and answers the explicit source-unavailable error instead of emitting entries, so in that situation the CONSUMER's own explicit-unknown mark is what a directory face renders. The facade never presents a stale derivation as current.

The status MUST be derived only from facts the facade already holds — the deployment row's pause flag and the facade's own usage ledger. It MUST NOT be inferred from silence, MUST NOT consult a second health source, MUST NOT default to `serving`, and MUST NOT report `serving` for a deployment whose snapshot is hard-stale. `status_as_of` SHALL name the snapshot instant the derivation used, so an external consumer can tell a freshly derived status from one derived up to the hard window ago (the snapshot is served stale within that window by an existing rule).

#### Scenario: A paused deployment is reported paused

- **WHEN** the deployment bookkeeping marks an agent paused while it is still listed publicly
- **THEN** its catalog entry carries `status: "paused"`

#### Scenario: Silence is reported as idle, never as serving

- **WHEN** an agent is not paused and has served zero external turns in the last 7 days
- **THEN** its catalog entry carries `status: "idle"`, not `serving`

#### Scenario: Past the hard window the face degrades instead of inventing a status

- **WHEN** the deployment snapshot is past its hard staleness window
- **THEN** the catalog answers the explicit source-unavailable error (the pre-existing rule) rather than serving entries whose status was derived from a stale snapshot, and a directory face renders its own unknown mark

#### Scenario: The status fields are purely additive

- **WHEN** a caller requests the catalog with no query parameters
- **THEN** the response carries the new fields and is otherwise field-for-field identical to the shape before this change

### Requirement: The catalog identifies itself as the deployed-instance view

The public catalog SHALL describe itself as the view of agents currently deployed for external serving, not as a marketplace directory of all published material. Its entries SHALL NOT introduce listing semantics the supply domain owns (publication state, version history, install actions); those remain the supply catalog's. When a pack has no deployment, it MUST be absent from this catalog rather than represented as an unlisted row.

#### Scenario: A published but undeployed pack is absent

- **WHEN** a pack is published in the supply catalog and has never been deployed
- **THEN** it does not appear in the Wanxing public catalog

#### Scenario: The view names its own scope

- **WHEN** a consumer or a human reads the catalog's documented scope
- **THEN** it is stated as the deployed-instance view, and publication/install semantics are explicitly out of scope

### Requirement: The catalog's chatability marker agrees with the chat lane

The public catalog's chatability marker SHALL be computed from the same admission state the chat lane enforces. A deployment that is paused SHALL NOT be marked chatable, because the chat lane refuses that same deployment — two faces of this facade MUST NOT disagree about whether a given agent can be chatted with. The marker's pause input SHALL be the deployment's real pause state, never a constant.

#### Scenario: A paused agent is not marked chatable

- **WHEN** a public agent is paused and still listed in the catalog
- **THEN** its entry carries no chatability marker, and the chat status endpoint for the same agent reports the paused reason — the two faces agree

#### Scenario: The two faces agree for every listed agent

- **WHEN** the catalog and the per-agent chat status endpoint are read for the same public agent
- **THEN** `chatable` in the catalog and `chatAble` in the status response have the same value

### Requirement: Outbound dependency addressing resolves through one declared table

Every outbound read of a borrowed dependency's address or credential SHALL resolve through one declared table and one resolver, keyed by upstream and component. The table SHALL name, for each upstream, the canonical variable, the accepted aliases, the default, and whether it is required. Two code paths in the same component that address the same upstream SHALL accept exactly the same alias set with the same precedence — a narrower alias set on one path is a defect, because it makes a configured deployment work on one face and fail on another. A new upstream SHALL be added to the table rather than read inline at its call site. Resolution SHALL NOT fabricate a value: an unconfigured upstream resolves to absent, leaving the existing explicit degradation (a 503, or a hidden affordance) unchanged.

#### Scenario: Both faces of one upstream accept the same aliases

- **WHEN** a deployment configures only the legacy alias of the memory upstream and both the chat lane and the console memory face address it
- **THEN** both resolve it, and neither reports unconfigured

#### Scenario: Different components may name one upstream differently

- **WHEN** the facade and the observer address the registry upstream through their own variable families
- **THEN** both resolve through the table, and the table records both families as the same upstream

#### Scenario: An unconfigured upstream stays explicitly absent

- **WHEN** an upstream has no value configured under any of its declared names
- **THEN** it resolves to absent and the dependent face keeps its explicit degradation, never a fabricated default or a silent empty success

#### Scenario: Inline addressing is refused

- **WHEN** a new outbound dependency read reads its variable directly at the call site instead of through the table
- **THEN** the change is refused in review, because the dependency becomes undiscoverable

### Requirement: Lifecycle state has exactly one write rule

Pausing and resuming a deployment SHALL be written by one rule whose payload is pinned by a published fixture (`contracts/lifecycle-write.fixture.json`): read the registry entry, set `metadata.paused` when pausing, and REMOVE the key when resuming — never write `paused: false`. Every door that pauses or resumes (this facade's console face and the platform's deployments face) SHALL produce the same registry result for the same agent, and the two implementations SHALL each be validated against the same fixture rather than against a shared code dependency.

#### Scenario: Resuming removes the key rather than writing false

- **WHEN** a resumed deployment's registry entry is read back
- **THEN** it carries no `metadata.paused` key, exactly as the fixture declares

#### Scenario: Two doors, one result

- **WHEN** the same deployment is paused through the facade's console face and, separately, through the platform's deployments face
- **THEN** both leave the registry in the same state, and any divergence fails the fixture test on the side that drifted

#### Scenario: The upsert fallback is part of the rule

- **WHEN** the registry's update route refuses the write and the create-side register route has to carry it
- **THEN** the same payload semantics apply, and a failure of both is reported as a registry write failure rather than a silent success

### Requirement: The public catalog can order its list by activity

公开目录（`GET /api/wanxing/v1/agents`）SHALL 支持可选参数 `sort`。取值为 `activity` 时，返回列表按
一条全序排列：精选在前；其余按实例状态分组——在役 → 尚无调用 → 状态未知 → 已暂停；组内按 `turns7d`
降序；仍并列则按 `name` 升序（决定性，不留并列）。

`sort` 缺失或取值未定义时，响应 SHALL 与引入该参数之前完全相同（registry 顺序）。

#### Scenario: 精选与在役在前

- **WHEN** 调用方请求 `?sort=activity`
- **THEN** 精选条目排在所有非精选条目之前，在役条目排在所有「尚无调用」条目之前

#### Scenario: 同组内按 7 天回合降序

- **WHEN** 两个条目同属在役组，`turns7d` 分别为 9 与 2
- **THEN** `turns7d` 为 9 的条目排在前面

#### Scenario: 并列时有决定性次序

- **WHEN** 两个条目同组且 `turns7d` 相等
- **THEN** 按 `name` 升序决定先后，同一份数据两次请求得到同一顺序

#### Scenario: 已暂停排在最后

- **WHEN** `?sort=activity` 的响应里同时含 serving、idle 与 paused 三类条目
- **THEN** paused 条目排在全部 serving 与 idle 条目之后

#### Scenario: 未知取值按缺省处理

- **WHEN** 调用方请求 `?sort=recent`（未定义的取值）
- **THEN** 按缺省 registry 顺序返回，不报错

### Requirement: Activity ordering reorders without filtering

`sort` SHALL 是纯排序：它 MUST NOT 过滤任何条目、MUST NOT 改变条目字段、MUST NOT 影响 `total` 与
`facets` 计数（`facets` 仍统计未过滤的公开全量列表）。排序 SHALL 发生在分页之前，因此 `page` /
`page_size` 切的是排好序的列表。

#### Scenario: 排序先于分页

- **WHEN** 调用方请求 `?sort=activity&page=2&page_size=10`
- **THEN** 返回的是排好序列表的第 11–20 条，而非未排序列表第 11–20 条再排序

#### Scenario: 条目集合与计数不变

- **WHEN** 同一公开集合分别以无参数与 `?sort=activity&facets=1` 请求
- **THEN** 两者的 `total`、`facets.total` 与 slug 集合相等，仅顺序不同

#### Scenario: 无参数调用保持既有形状

- **WHEN** 调用方请求 `GET /agents`（无 `q` / `category` / `featured` / `cluster` / `sort`）
- **THEN** 响应与引入 `sort` 之前完全一致（全量列表，registry 顺序）

### Requirement: Registry entries are served from one shared snapshot per read

门面 SHALL 维护一份进程内的 registry 条目快照，作为目录（`GET /agents`）、公开状态（`GET /status`）与控制台部署列表（`GET /console/deployments`）读取 registry 条目的唯一来源。快照 SHALL 经 registry 的列表读面获得，MUST NOT 由逐 agent 的单条读拼装。

一份快照刷新 SHALL 只向 registry 发出一次逻辑读取；一次请求的上游读次数 SHALL 与已部署 agent 的数量无关。快照新鲜时，一次目录请求的 registry 读次数 SHALL 为 0。

快照 SHALL 以 60 秒 TTL 刷新，并发刷新 SHALL 合并为一次（single-flight）。刷新失败时 SHALL 继续提供上一份快照（stale-on-hiccup），MUST NOT 因一次上游失败清空目录。

#### Scenario: One logical read serves N deployments

- **WHEN** 已部署 27 个 agent 且快照新鲜
- **THEN** 一次目录请求产生的 registry 读为 0 次；快照过期后的第一次请求产生 1 次逻辑读取
- **AND** 单条读（`GET /api/agents/{path}`）不在目录路径上被调用

#### Scenario: Concurrent readers share one refresh

- **WHEN** 快照过期后有 20 个并发目录请求到达
- **THEN** 上游只收到一次列表读取，20 个请求共享同一份结果，且总耗时不随并发数线性增长

#### Scenario: Upstream hiccup keeps serving

- **WHEN** 一次刷新失败，且上一份快照仍在硬过期窗口内
- **THEN** 目录、公开状态与控制台列表继续用上一份快照应答，不返回错误

#### Scenario: A deployment absent from the registry is absent from the catalog

- **WHEN** 一个部署在 registry 中没有对应条目
- **THEN** 该条目不出现在目录中，且不产生一条伪造的占位条目
- **AND** 结果与逐条读该 agent 得到 404 时的可见行为一致

#### Scenario: Private entries stay out of the public faces

- **WHEN** 快照中含 `visibility: private` 的条目
- **THEN** 目录、公开状态与公开卡片面都不呈现它，与快照引入之前的判定一致

### Requirement: Synthesized entry fields carry a documented source

列表读面不携带 registry 单条读面的全部字段。门面 SHALL 按下表合成这些字段，MUST NOT 用占位值或臆测值填充：

| 字段 | 来源 |
|---|---|
| `version` | 部署台账的 `dep.version`；该部署不在台账中时，退回条目的 `metadata.packVersion` |
| `capabilities` | 条目的 `streaming` 标志 → `{ streaming: true }`；为假时为空对象 |
| `provider` | 条目的 `provider_organization` / `provider_url` → `{ organization, url }` |
| `examples` | 不提供（列表读面不携带；目录与卡片面在该字段缺席时保持既有形状） |

`version` SHALL 是**已发布的包版本**，MUST NOT 是 registry 条目上陈旧的 `version` 字段值。

#### Scenario: version is the published pack version

- **WHEN** registry 条目的 `version` 为 `"1"` 而部署台账中该 agent 的版本为 `10`
- **THEN** 目录行与公开卡片的 `version` 为 `10`

#### Scenario: capabilities reflects the declared streaming flag

- **WHEN** 条目的 `streaming` 为真
- **THEN** 卡片面的 `capabilities` 为 `{ streaming: true }`；为假时为空对象，两者均与逐条读该条目得到的值相等

#### Scenario: provider keeps the public redaction rule

- **WHEN** 条目的 `provider_url` 指向非公网可达地址
- **THEN** 卡片面照既有脱敏规则移除 `url` 键，只留 `organization`

### Requirement: Cluster units share the same snapshot cadence

集群单位列表 SHALL 与 registry 条目快照同节奏缓存；MUST NOT 在每次请求时重新推导集群索引与部署列表。

#### Scenario: Repeated catalog reads do not recompute units

- **WHEN** 同一分钟内多次请求目录
- **THEN** 集群单位只推导一次，后续请求复用该结果

### Requirement: A registry-disabled entry is not served anywhere

registry 条目的 `is_enabled` 为假时，该 agent SHALL 视为不可服务，SHALL NOT 出现在公开目录、`facets` 计数、`/status` 的目录规模、公开卡片面，也 SHALL NOT 被标记 chatable。API 车道与对话车道的准入 SHALL 拒绝它，并以独立于「已暂停」的代码说明原因（两件事、两种运维动作）。

判定 SHALL 只读 registry 条目的既有字段，MUST NOT 引入门面自己维护的下架名单。

#### Scenario: A disabled agent disappears from the catalog

- **WHEN** 一个公开 agent 在 registry 被置为 `is_enabled = false`
- **THEN** 下一次快照刷新后它从目录、`facets` 计数与 `/status` 的目录规模中消失，卡片面 404，`chatAble` 为假

#### Scenario: The API lane names the reason

- **WHEN** 调用者向一个被禁用（但未暂停）的 agent 发起 `message/send`
- **THEN** 准入返回 `AGENT_DISABLED`，而不是通用的未找到或已暂停

#### Scenario: Disabled and paused are not the same fact

- **WHEN** 一个 agent 处于 `paused`（部署者动作）而另一个处于 `is_enabled = false`（registry 动作）
- **THEN** 两者被拒绝的代码不同，界面也 SHALL NOT 把其中一个说成另一个

### Requirement: Catalog joins never block the request on snapshot expiry

目录读取（`GET /agents`、`GET /status`、控制台部署列表）所依赖的 join 快照——策展（curation）、集群
索引（cluster）、集群单元列表（cluster units）、外部系统声明（declarations）、近 7 天活跃（turns7d）
——SHALL 遵循 stale-while-revalidate：
快照新鲜时零上游读；快照过期时 SHALL 立即以上一份快照应答，并在后台执行一次单飞刷新，MUST NOT 让请求
原地等待刷新完成。

冷启动（从未成功加载过）SHALL 阻塞一次并等待首份快照；首份加载失败 SHALL 沿用既有降级语义
（该 join 无信号 / 空映射），MUST NOT 让整张目录失败或返回 5xx——目录的可达性不由任一 join 决定。

刷新失败 SHALL 保留上一份快照（既有 stale-on-hiccup 语义），MUST NOT 清空或回退为全空。

该要求不改变任何响应形状、缺省排序、TTL 数值或硬窗口语义。

#### Scenario: An expired join serves the last-known snapshot

- **WHEN** 某个 join 快照已超过 TTL 且刷新需要一次上游往返
- **THEN** 请求以上一份快照立即应答，刷新在后台进行，响应耗时与该上游往返无关

#### Scenario: A cold join blocks exactly once

- **WHEN** 进程启动后第一次读取目录，五个 join 均无快照
- **THEN** 请求等待首份快照加载完成后应答；后续请求不再付费等待

#### Scenario: Concurrent readers share one refresh

- **WHEN** 快照过期的瞬间有并发目录请求
- **THEN** 只发出一次上游刷新，所有请求立即拿到同一份上一份快照

#### Scenario: A failed refresh keeps the last-known maps

- **WHEN** 刷新失败（上游不可达或返回错误）
- **THEN** 目录继续使用上一份快照，受影响的 join 保持上次的语义（无策展字段仍渲染为未分组，活跃数保持上次读数）
