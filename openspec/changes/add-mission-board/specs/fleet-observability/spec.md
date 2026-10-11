# fleet-observability Specification

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: board 携带 mission 总览段

`/api/fleet/v1/board` SHALL 增 `missions` 段：从最近 24h 的 mission.* 原始流合成，每条携带 mission id、owner、当前状态（最新转移）、状态轨迹（去重的 to 序列）、花费分钟（exhausted/终态事件的 payload 若带）；该段 SHALL 不走 hour×agent rollup（mission 事件量小，bounded 原始窗即可）。无 mission 事件时 `missions` SHALL 为空数组而非字段缺席。

#### Scenario: 一屏见任务

- **WHEN** 24h 内有 mission 走到 reported
- **THEN** board.missions 含该 mission，状态 reported、轨迹与 owner 可见

#### Scenario: 空窗不隐段

- **WHEN** 24h 内无任何 mission 事件
- **THEN** board.missions 为空数组，段仍在

## MODIFIED Requirements

### Requirement: 观测 API

系统 SHALL 提供 `GET /api/fleet/v1/board`（机群总览：五态分布与总数、驻留水位、唤醒
延迟 p50/p95、退温/驱逐、budget kill、摄取滞后、结算 pending、**mission 总览段**
——add-mission-board，见 ADDED「board 携带 mission 总览段」）与
`GET /api/fleet/v1/agents/:slug/timeline`（单 agent 生命周期时间线），以服务凭据或
admin 门禁。

#### Scenario: board 指标齐备

- **WHEN** 门禁内请求 /api/fleet/v1/board
- **THEN** 响应含首版指标全集，且摄取滞后独立于来源时间戳口径

#### Scenario: 单 agent 时间线

- **WHEN** 请求某 slug 的 timeline
- **THEN** 返回按 ts 排序的生命周期事件，含台账合成类（deployed/paused 等）
