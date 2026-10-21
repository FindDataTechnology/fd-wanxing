## Purpose

舰队消耗统计面：fleet 事件、sub2api 计费、本地 harness 三路消耗的聚合与展示契约——展示聚合层，永不做第二计费真源。

## ADDED Requirements

### Requirement: fleet 回合事件统计持久化与保留窗口分离

fleet-observer SHALL 将回合 usage 事件（tokens、模型、session、agent、pack、时长、结果）写入统计持久层：回合级明细 + 按 agent/pack/day/model 的聚合，统计保留窗口 13 个月滚动且每日聚合行永久保留；观测层既有保留策略（14 天）MUST NOT 因此改变。

#### Scenario: 观测窗口过期后统计仍在

- **WHEN** 某回合事件在观测层超过 14 天被清理后查询统计 API
- **THEN** 该回合的聚合贡献仍在，明细按 13 个月窗口可查

#### Scenario: usage 事件双写不丢观测

- **WHEN** 一条带 tokens 的 turn_ended 进入 ingest
- **THEN** 观测层行为（board/timeline/保留）与统计写入互不影响，ingest 失败于统计层时观测层照常入库并记录统计缺口

### Requirement: 统计 API 以口径分离为纪律

统计 API（总览/下钻/序列）SHALL 对每个数字标注 `source`（fleet|sub2api|local）与 `basis`（billed|estimated）；不同口径 MUST NOT 在服务端合并成单一数字；无标注的数字 MUST NOT 出现在 API 响应中。

#### Scenario: 两口径并排不混算

- **WHEN** 控制台请求总览
- **THEN** fleet 口径（estimated）与 sub2api 口径（billed）分别成列返回，响应中不存在两者的和或均值字段

### Requirement: sub2api 只读聚合通道

统计面 SHALL 经 sub2api admin API 拉取用量聚合（小时级、只读、凭据走部署 secret）落库为 `source=sub2api, basis=billed`；MUST NOT 直连 sub2api 数据库；拉取失败 MUST 降级开放（展示最近成功聚合并标注 stale 时间）。

#### Scenario: sub2api 不可达时降级展示

- **WHEN** 小时级拉取连续失败
- **THEN** API 返回既有聚合并附 `stale_since`，不阻塞其他口径的数字

### Requirement: 本地采集器解析本机 harness 日志并批投

collector SHALL 以解析器注册表方式解析本机 harness 消耗日志（v1：Claude Code 会话 JSONL 的 usage 字段），按小时批投 fleet-observer 的 local ingest 通道（tailnet 直连、collector 令牌鉴权、`source=local, basis=estimated`）；解析失败的单文件 MUST 跳过并计数，不中断批投。

#### Scenario: 增量解析不重投

- **WHEN** collector 小时批运行时某 JSONL 自上次位点后新增了回合
- **THEN** 只投新增部分，位点持久化在本机

#### Scenario: 无令牌投递被拒

- **WHEN** local ingest 收到无有效 collector 令牌的投递
- **THEN** 结构化拒绝，不入库

### Requirement: 控制台消耗视图分列三口径

萬星控制台运营段 SHALL 提供消耗视图：时间窗选择、总览卡、agent/pack/model 下钻、每日序列；每个数字块 MUST 展示其口径标注（fleet 估算 / sub2api 计费 / local 估算），billed 与 estimated 在视觉上可区分。

#### Scenario: 浏览器眼见三口径

- **WHEN** 打开消耗视图选择最近 7 天
- **THEN** fleet/sub2api/local 三口径各自成块或成列，无任何合并数字，每块带口径标签
