# fleet-observability Specification Delta

## ADDED Requirements

### Requirement: 生命周期事件摄取

系统 SHALL 提供 `POST /ingest` 批量摄取端点，以萬星服务凭据门禁（匿名拒绝）。重复
投递同一 (source, id) 的事件 SHALL 幂等（仅落一行）；来源时钟与摄取时钟 SHALL 分列
存储。

#### Scenario: 重复投递幂等

- **WHEN** 同一批事件因重放被投递两次
- **THEN** 事件库中每个 (source, id) 恰有一行，无重复计数进入 rollup

#### Scenario: 匿名摄取被拒

- **WHEN** 无服务凭据的请求调用 /ingest
- **THEN** 响应 401 且不落任何行

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
