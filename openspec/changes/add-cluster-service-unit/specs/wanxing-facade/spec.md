## ADDED Requirements

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
