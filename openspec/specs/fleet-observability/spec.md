# fleet-observability Specification

## Purpose

The Wanxing plane's observability data plane: lifecycle event ingestion
(runner direct-post, facade cross-process, bookkeeping synthesis), the
append-only event store with bounded raw retention, the hour×agent rollup as
the only aggregate query face, and the observation API (board + per-agent
timeline).

## Requirements

### Requirement: 生命周期事件摄取

系统 SHALL 提供 `POST /ingest` 批量摄取端点，以萬星服务凭据门禁（匿名拒绝）。重复
投递同一 (source, id) 的事件 SHALL 幂等（仅落一行）；来源时钟与摄取时钟 SHALL 分列
存储。接受的 kind 白名单 SHALL 覆盖部署/回合/结算/状态族与 **mission 生命周期族**
（`mission.submitted|planning|plan_ready|approved|scheduled|executing|reported|failed|aborted|exhausted`——add-mission-board：任务定义面的转移事件此前被整批拒收）；白名单外的 kind 仍整批拒绝。

#### Scenario: 重复投递幂等

- **WHEN** 同一批事件因重放被投递两次
- **THEN** 事件库中每个 (source, id) 恰有一行，无重复计数进入 rollup

#### Scenario: 匿名摄取被拒

- **WHEN** 无服务凭据的请求调用 /ingest
- **THEN** 响应 401 且不落任何行

#### Scenario: mission 转移事件被收下

- **WHEN** 一批携带 `mission.reported` 的事件经服务凭据投递
- **THEN** 事件落库一行，board 的 missions 段可见该 mission

### Requirement: 事件存储与保留

原始生命周期事件 SHALL append-only 存于萬星数据根的独立 SQLite 库，保留 14 天后清理；
hour×agent rollup SHALL 长存且幂等可重算。板面查询 SHALL 只走 rollup 与最近 24 小时
原始流，不走全量原始表扫描。

#### Scenario: 保留窗清理

- **WHEN** 原始事件行龄超过 14 天
- **THEN** 清理任务将其删除，rollup 行不受影响

#### Scenario: rollup 重算幂等

- **WHEN** 同一 (hour, agent) 的 rollup 被重复计算
- **THEN** 结果被覆盖而非叠加

### Requirement: 生命周期事件模型

事件 SHALL 为粗粒度生命周期迁移（deployed/undeployed/paused/resumed/woken/reaped/
budget_killed/turn_started/turn_ended/settled/admitted/refused/state_changed/
runner_stats），回合类事件 SHALL 以 trace_id 引用 turn-tracing 而不复制回合内容；
runner 来源事件 SHALL 携带 runner 身份，聚合查询 SHALL 不假设单一 runner。

#### Scenario: 回合事件引用不复制

- **WHEN** 一次回合产生 turn_started/turn_ended 事件
- **THEN** 两事件各携带该回合 trace_id，事件库中不存在回合内部（dsh 流）内容

#### Scenario: 双 runner 并存

- **WHEN** 两个 runner 各自上报其 agent 事件
- **THEN** board 聚合按 runner 分列可见，总量正确

#### Scenario: 五态迁移与水位由 runner 采样承载

- **WHEN** 一个 runner 上的 agent 状态迁移且 runner 周期采样
- **THEN** state_changed 事件记录迁移前后状态，同批 runner_stats 携带驻留水位（children/queued/budget/budget 上限），board 的五态分布与水位由此合成

### Requirement: 观测 API

系统 SHALL 提供 `GET /api/fleet/v1/board`（机群总览：五态分布与总数、驻留水位、唤醒
延迟 p50/p95、退温/驱逐、budget kill、摄取滞后、结算 pending）与
`GET /api/fleet/v1/agents/:slug/timeline`（单 agent 生命周期时间线），以服务凭据或
admin 门禁。

#### Scenario: board 指标齐备

- **WHEN** 门禁内请求 /api/fleet/v1/board
- **THEN** 响应含首版指标全集，且摄取滞后独立于来源时间戳口径

#### Scenario: 单 agent 时间线

- **WHEN** 请求某 slug 的 timeline
- **THEN** 返回按 ts 排序的生命周期事件，含台账合成类（deployed/paused 等）

### Requirement: board 携带 mission 总览段

`/api/fleet/v1/board` SHALL 增 `missions` 段：从最近 24h 的 mission.* 原始流合成，每条携带 mission id、owner、当前状态（最新转移）、状态轨迹（去重的 to 序列）、花费分钟（exhausted/终态事件的 payload 若带）；该段 SHALL 不走 hour×agent rollup（mission 事件量小，bounded 原始窗即可）。无 mission 事件时 `missions` SHALL 为空数组而非字段缺席。

#### Scenario: 一屏见任务

- **WHEN** 24h 内有 mission 走到 reported
- **THEN** board.missions 含该 mission，状态 reported、轨迹与 owner 可见

#### Scenario: 空窗不隐段

- **WHEN** 24h 内无任何 mission 事件
- **THEN** board.missions 为空数组，段仍在

### Requirement: board 携带 cell 短期执行段

The ingest SHALL accept the `cell_stats` event kind (enumerated whitelist — no wildcard), and
the board SHALL carry a `cells` object holding the freshest `cell_stats` payload per cell
identity within a 30-minute window (same shape as the runners segment), plus a `shortterm`
rollup: the number of reporting cells, summed in-flight executions (running / queued), and
summed worker-pool occupancy (busy / idle / cap). Cell identities SHALL NOT enter the
`agents_total` count or the `states` distribution — those remain resident serving-agent scopes.

#### Scenario: cell_stats 摄取并合成为 cells 段

- **WHEN** two `cell_stats` events with distinct cell identities ingest within the window
- **THEN** the board's `cells` object carries one entry per identity with the freshest payload,
  and `shortterm` sums their executions and worker occupancy

#### Scenario: 旧事件不出现，空窗口保形

- **WHEN** the window holds no `cell_stats` events
- **THEN** `cells` is an empty object and `shortterm` reports zero counts (the segment stays
  present, never absent)

#### Scenario: cell 身份不污染常驻口径

- **WHEN** `cell_stats` events ingest alongside runner agent events
- **THEN** `agents_total` and `states` count only the resident agents, exactly as before

#### Scenario: 白名单之外的 kind 仍被拒

- **WHEN** an event with an unknown kind posts to ingest
- **THEN** the batch is refused with 400, as before

### Requirement: Rollup 补算自进度驱动且覆盖整个保留窗口

hour×agent rollup 的补算 SHALL 由持久化的「上次已算进度」驱动（不再固定 48 小时上限），单次补算上限 SHALL 等于原始事件保留期（14 天）：服务恢复或重启后，凡仍在保留窗内的原始事件 MUST 全部进入 rollup，不因宕机时长产生永久统计空洞。

#### Scenario: 宕机 72 小时后恢复

- **WHEN** fleet-observer 停机 72 小时（超过旧 48h 上限）后恢复
- **THEN** 保留窗内的全部未算小时被补进 rollup，board 与 stats 面在该时段无空洞

#### Scenario: 进度持久且可重放

- **WHEN** 补算进行中进程再次被杀
- **THEN** 重启后从已持久化的进度续算，已算小时幂等覆盖不叠加

### Requirement: Each agent carries a derived health state

The observer SHALL derive, from the existing hourly rollup, a health state per agent over a bounded window and SHALL expose it as `ok`, `degraded`, `silent`, `paused`, or `failing`. The state SHALL distinguish "no turns" from "all turns failing" — a window with zero turns SHALL be reported as `silent`, never as healthy and never as failing.

`failing` SHALL require both that every turn in the window failed and that the agent's consecutive failure volume reaches an independently configured minimum; it SHALL NOT be derived from a percentage alone. `degraded` SHALL require a mix of successful and failed turns with the failure ratio at or above an independently configured threshold. An agent whose registry entry marks it paused SHALL be reported as `paused` regardless of its turn outcomes.

#### Scenario: An agent that fails every turn is failing

- **WHEN** an agent has at least one turn in the window, every turn failed, and its consecutive failure volume reaches the configured minimum
- **THEN** its health state is `failing` and the response carries how long it has been failing

#### Scenario: No traffic is silent, not healthy and not failing

- **WHEN** an agent has zero turns in the window
- **THEN** its health state is `silent`

#### Scenario: A paused agent is never reported as failing

- **WHEN** an agent's registry entry marks it paused and its recent turns all failed
- **THEN** its health state is `paused` and it is excluded from the unhealthy set

#### Scenario: A mixed agent is degraded, not failing

- **WHEN** an agent has both successful and failed turns and its failure ratio is at or above the configured threshold but not every turn failed
- **THEN** its health state is `degraded`

#### Scenario: Thresholds are independent of any polling period

- **WHEN** the failing minimum, the degraded ratio, and the window length are configured
- **THEN** each is read from its own setting and none is computed from a scheduler or poll interval

### Requirement: Health carries a failure cause, and "unknown" is distinct from "none"

A health entry SHALL carry the kind of the most recent failure, derived from existing turn event payloads where available, and SHALL answer `unknown` when a failure occurred but no classification could be derived. For an agent with no failure in the window the field SHALL be absent or null — never the string `unknown`.

#### Scenario: A cold-start failure is classified

- **WHEN** the most recent failure was a cold-start resolution failure
- **THEN** the health entry reports that cause rather than a generic error

#### Scenario: Unclassified failure is unknown, healthy is null

- **WHEN** a failing turn carried no recognisable cause
- **THEN** the entry answers `unknown`; and when the agent has no failure in the window the field is null

#### Scenario: An unreachable dependency does not fabricate a state

- **WHEN** the registry cannot be reached so the pause flag cannot be read
- **THEN** that agent's health is skipped as stale for the pass instead of being reported as healthy

### Requirement: Health transitions emit one edge event

The observer SHALL emit an `agent_unhealthy` event when an agent's health crosses into `failing`, and a paired recovery event when it leaves, at most once per transition rather than once per failing turn. The event payload SHALL carry the agent, the failing-since timestamp, the consecutive volume, the failure cause, and the window length. A repeated computation for a transition already emitted SHALL NOT emit again.

#### Scenario: Crossing into failing emits once

- **WHEN** an agent's health changes from a non-failing state to `failing`
- **THEN** exactly one `agent_unhealthy` event is emitted for that transition

#### Scenario: Continued failing does not re-emit

- **WHEN** a subsequent computation still finds the same agent failing with the same start
- **THEN** no further event is emitted

#### Scenario: Recovery is emitted in the same shape

- **WHEN** a failing agent's health returns to a non-failing state
- **THEN** one recovery event is emitted carrying the same failing-since reference so the pair can be matched

### Requirement: A silent agent declares whether it was expected to be silent

A health entry reporting `silent` (no turns in the window) SHALL additionally report the agent's
declared rhythm interval, the number of turns that interval implies for the window, and whether the
agent is stalled — stalled meaning its declared rhythm implies at least a configured minimum number
of turns while the window observed none. The state itself SHALL remain `silent`: the extra fields
annotate the observation, they do not replace it.

An agent whose entry carries no recognisable rhythm declaration SHALL report no implied turn count
and SHALL NOT be marked stalled — zero turns is that agent's normal life. A paused agent SHALL
remain `paused` and SHALL NOT be evaluated for staleness. When the rhythm declaration cannot be
read because its source is unavailable, the entry SHALL degrade to "no declared rhythm" rather than
guessing, and SHALL NOT be marked stalled.

#### Scenario: A rhythmic agent with zero turns is stalled

- **WHEN** an agent declares an hourly rhythm and its window contains zero turns while the implied count reaches the configured minimum
- **THEN** the entry stays `silent` and additionally reports the declared interval, the implied turn count, and `stalled` true

#### Scenario: A non-rhythmic agent is silent, not stalled

- **WHEN** an agent has no recognisable rhythm declaration and its window contains zero turns
- **THEN** the entry reports `silent` with no implied count and is not marked stalled

#### Scenario: Too few implied turns is not evidence

- **WHEN** an agent's declared rhythm implies fewer turns for the window than the configured minimum
- **THEN** it is not marked stalled even though it observed none

#### Scenario: A paused agent is never stalled

- **WHEN** an agent is paused and its window contains zero turns
- **THEN** the entry reports `paused` and carries no staleness verdict

#### Scenario: An unreadable declaration degrades to no declaration

- **WHEN** the rhythm declaration is unavailable or in a shape the observer cannot parse
- **THEN** the entry reports no implied count and is not marked stalled, and the rest of the health entry is unaffected

#### Scenario: An agent with turns carries no implied count

- **WHEN** an agent's window contains at least one turn
- **THEN** its entry carries no implied turn count and no staleness verdict

### Requirement: Registry paths and rollup identities are mapped by one rule

Every component of this repository that derives an agent's public identity (slug) from a registry path — the observer and the facade, including every face the facade mounts — SHALL use ONE shared derivation, and SHALL NOT maintain a second, divergent derivation inside this repository. A path that fails to map SHALL be treated as having no declaration rather than as a distinct agent. The derivation's behavior SHALL additionally be pinned by a published fixture (`contracts/agent-identity.fixture.json`) covering the boundary cases — leading slashes, upper case, underscores, runs of disallowed characters (which collapse per run, not per character), non-ASCII runs, the empty path, and an already-slugged path — so sibling repositories can assert the same behavior without sharing code.

#### Scenario: A registry path maps to the rollup identity

- **WHEN** the registry reports a deployment at a path containing upper case and underscores
- **THEN** the derived slug equals the identity the rollup uses for that agent's turns, so its declared rhythm is applied to the right entry

#### Scenario: Mapping happens in exactly one place

- **WHEN** any part of the observer needs an agent's slug from its registry path
- **THEN** it uses that single shared derivation

#### Scenario: The facade derives identity from the same function

- **WHEN** a component of the facade (public catalog, self-service deploy path, or any other face) needs an agent's slug from a registry path
- **THEN** it uses the same shared derivation as the observer, not a local re-implementation

#### Scenario: The fixture pins the boundary behavior

- **WHEN** the shared derivation's output for any fixture case differs from the published expectation
- **THEN** the test fails and names the offending input path

#### Scenario: A sibling implementation diverges

- **WHEN** a sibling repository's implementation disagrees with the published fixture
- **THEN** that repository's own fixture test fails, without either repository importing the other's code
