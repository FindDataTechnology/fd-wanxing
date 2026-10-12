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

The facade SHALL deduplicate `message/send` requests by the `Idempotency-Key` header, scoped per (caller, agent): a repeated key within the retention window returns the recorded first outcome without running another turn, and concurrent duplicates result in exactly one turn.

#### Scenario: A replayed key returns the recorded outcome

- **WHEN** the same (caller, agent, Idempotency-Key) is replayed after the first request completed
- **THEN** the recorded first outcome is returned and no second turn runs

#### Scenario: Concurrent duplicates run one turn

- **WHEN** two requests with the same Idempotency-Key race while the first turn is still running
- **THEN** exactly one turn executes and both callers receive its outcome

### Requirement: External traffic is bounded per caller and agent

The facade SHALL bound in-flight turns to one per (caller, agent): a second concurrent request SHALL be refused with a structured retry-after error, never interleaved into the running turn. The facade SHALL additionally enforce a configurable per-caller rate limit across agents.

#### Scenario: A concurrent second turn is refused with retry-after

- **WHEN** a caller issues a second request to the same agent while its previous turn is still in flight
- **THEN** the request is refused with a retry-after error and the running turn is unaffected

#### Scenario: A burst over the rate limit is throttled

- **WHEN** a caller exceeds the configured request-rate bound
- **THEN** further requests are throttled with a structured rate-limit error

### Requirement: Admitted turns are metered and settled at the boundary

For every admitted external turn the facade SHALL record caller, agent, idempotency key, outcome, and duration in the facade ledger, and on completion SHALL settle the caller by duration — rounded up to whole minutes at the platform-configured rate. Settlement SHALL elect by the caller's plan state: a caller with an active plan settles through an idempotent plan-minute drawdown recorded with settler `plan` (see serving-plans); a planless caller settles through an idempotent key balance deduction as before. Settlement failures on the deduction path SHALL retry with backoff; repeated failure or an exhausted balance SHALL suspend the caller, whose next admission is refused until the key passes the billing gate again. A deduction-path settlement that succeeds SHALL, in the same turn, credit the deployment's deployer a revenue share per the deployer-earnings capability when the turn is externally settled real money from a caller who is not the deployer.

#### Scenario: A completed turn settles exactly once

- **WHEN** an admitted turn completes
- **THEN** the caller is settled once for the minute-rounded duration at the configured rate, and the ledger records the settlement

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

### Requirement: Deployment bookkeeping snapshot serves resolution and change detection

The facade SHALL maintain an in-process cached snapshot of the deployment bookkeeping (the packs internal API), refreshed on a TTL with single-flight merging, indexed by slug for O(1) resolution. When the source is unreachable the last snapshot SHALL be served stale (matching the registry-entry cache's semantics); staleness beyond a hard window (5 minutes) SHALL degrade to the explicit source-unavailable error rather than serving an indefinitely stale catalog. Snapshot refreshes SHALL compute the deployment diff (added/removed/changed) via an exported pure function, so the fleet observer's bookkeeping-change detector (fd-wanxing program slice ③) reuses the same logic by minimal copy until the facade extraction converges it.

#### Scenario: Source hiccup serves stale

- **WHEN** a refresh attempt fails within the hard staleness window
- **THEN** resolution and the catalog continue serving the last snapshot without error

#### Scenario: Hard staleness degrades explicitly

- **WHEN** the snapshot has been unreachable for longer than the hard window
- **THEN** catalog and card routes respond with the explicit source-unavailable error instead of a stale list

#### Scenario: Diff detects bookkeeping changes

- **WHEN** a refresh observes deployments added, removed, or changed versus the previous snapshot
- **THEN** the exported diff function reports exactly those three buckets, and an unchanged refresh reports all three empty

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
