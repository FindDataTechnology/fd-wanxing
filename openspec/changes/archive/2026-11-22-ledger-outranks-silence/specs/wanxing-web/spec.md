# Spec Delta

## MODIFIED Requirements

### Requirement: One status fact, one badge, across every surface

萬星的每一个展示面（公开目录、agent 详情、部署者舰队卡、运维面机群板）SHALL 用同一张事实表与同一条
优先级链把 agent 的当前状态说成**一枚**人读主徽标，而不是各自发明词汇。

事实表 SHALL 覆盖且仅覆盖以下七种事实，优先级由高到低：

| 优先级 | 事实 | 依据 |
|---|---|---|
| 1 | 已暂停 | 管理员暂停（`status=paused` 或 `health=paused`） |
| 2 | 状态未知 | 快照过期/未上报（`status=unknown`，或观测面无该 agent 的 health 条目） |
| 3 | 持续失败 | `health=failing` |
| 4 | 部分失败 | `health=degraded` |
| 5 | 该跑没跑 | `health=silent` 且 `health.stalled=true` |
| 6 | 在役 | `status=serving` 或 `health=ok` |
| 7 | 尚无调用 | `status=idle`，或 `health=silent` 且未 stalled |

主徽标的判定 SHALL 按优先级取第一个命中项——**同一次渲染里同一 agent 的状态位置只 SHALL 出现一枚
主徽标**，不得并列出现两枚语义冲突的状态徽标（例如「运行中」与「持续失败」并排）。

**证据强度：台账压过观测推断。** `status=serving` 的读数是计费台账的「近 7 天有人调用」，
`health=silent` 是观测采样得出的推断。两者冲突时「在役」SHALL 命中，MUST NOT 被改写成「尚无调用」——
否则同一张舰队卡会出现「徽标：尚无调用 / 下一行：近 7 天回合 9」的自相矛盾。`health=silent`
SHALL 仅在台账同样为零（`status=idle`）时决定主徽标。

展示措辞 SHALL NOT 把「近 7 天有无调用」说成「进程运行中/空闲待命」——`serving` 的展示不得读作
「服务在运行」，`idle` 的展示不得读作「空闲待命」。

门面 `/api/wanxing/v1/agents` 的字段形状与取值（`status` 四值、`status_as_of`）SHALL NOT 因本条改变：
本要求约束**消费侧怎么读**，不约束生产侧怎么发。

#### Scenario: A failing agent shows one badge, not two

- **WHEN** 某 agent 的观测面 health 为 `failing`，门面 status 为 `serving`
- **THEN** 该 agent 在目录、详情、舰队卡上各自只出现一枚「持续失败」主徽标，不再出现与之并列的
  「运行中」或「在役」徽标

#### Scenario: Stalled differs from unused

- **WHEN** 某 agent 窗口内零回合，且其观测面 health 为 `silent` 并携带 `stalled=true`
- **THEN** 它的主徽标是「该跑没跑」（同时说明按声明应有几次），而不是「尚无调用」，也不是任何读起来健康的措辞

#### Scenario: Unreported status never reads as healthy

- **WHEN** 某 agent 门面 status 为 `unknown`，或观测面无该 agent 的 health 条目
- **THEN** 它的主徽标是「状态未知」，既不读作「在役」，也不读作「尚无调用」

#### Scenario: Served-but-idle is worded as traffic, not process

- **WHEN** 某 agent 门面 status 为 `idle`（近 7 天零调用）
- **THEN** 其徽标措辞表达「近 7 天无调用/尚无调用」之意，而不出现「空闲」这类会被读作「进程待命」的词

#### Scenario: The ledger outranks a silent observation

- **WHEN** 某 agent 门面 status 为 `serving`（计费台账显示近 7 天有回合），而观测面的 health 为 `silent`
- **THEN** 主徽标是「在役」而不是「尚无调用」，且该卡上的回合数字与徽标不矛盾

#### Scenario: Silence still speaks when the ledger agrees

- **WHEN** 某 agent 门面 status 为 `idle` 且观测面 health 为 `silent`（台账与观测都说零）
- **THEN** 主徽标是「尚无调用」
