## ADDED Requirements

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
| 6 | 尚无调用 | `status=idle` 或 `health=silent` 且未 stalled |
| 7 | 在役 | `status=serving` 且 `health=ok`（或无 health 条目但状态新鲜） |

主徽标的判定 SHALL 按优先级取第一个命中项——**同一次渲染里同一 agent 的状态位置只 SHALL 出现一枚
主徽标**，不得并列出现两枚语义冲突的状态徽标（例如「运行中」与「持续失败」并排）。

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

### Requirement: Absent signals never render as zeros

当某个数据面尚未返回（请求未落地、观测面无该段、summary 为 null）时，信号位 SHALL 渲染占位，
**SHALL NOT 渲染 0 或 $0.00**；当数据面已经返回且值确为零时，该组信号 SHALL 以一个明确的空态措辞
（例如「尚无调用记录」）替代成排的 0 与 $0.00。

#### Scenario: Summary not loaded yet

- **WHEN** 舰队卡的用量 summary 尚未返回
- **THEN** 近 7 天回合 / 近 30 天分钟 / 近 30 天结算三格显示占位，不显示 0、不显示 $0.00

#### Scenario: Real zeros speak as one sentence

- **WHEN** 用量 summary 已返回且三项全为 0
- **THEN** 三格收成一句「尚无调用记录」，而不是 `0 / 0 / $0.00`

### Requirement: The ops board is readable and states its scope

运维面机群板的顶行状态枚举 SHALL 以中文呈现，原始枚举值 SHALL 保留在可悬停的 `title` 或等价的
可达说明里（排障可读，访客不撞）。

该枚举行的状态 SHALL 明确区分于上文「跨面状态事实」——它统计的是 runner 生命周期的分布
（在役/常驻/已暂停/启动中/退出中/预热/未知），**不得**改写成 agent 状态主徽标的词汇，否则会把
「这一轮谁在跑」和「这个 agent 健不健康」混为一谈。

板 SHALL 带一行口径说明：板统计的是**窗口内被观测到的** agent，与公开目录的「在役 agent 数」不是
同一口径；两个数字不相等本身不是故障。

当板缺少某段数据（无 `runner_stats`、无任务、observer 未升级到携带 `cells`）时，空态 SHALL 说明
「为什么空」与「去哪看」，而不是只留一句「窗口内无 X」。

#### Scenario: Enum row reads in Chinese and stays a distinct vocabulary

- **WHEN** 部署者打开运维面，板回传 runner 生命周期 states 枚举
- **THEN** 顶行每个状态都以中文呈现且悬停可读到原始枚举值，且这些措辞与 agent 状态主徽标
  （在役/尚无调用/持续失败…）不混用

#### Scenario: Two counts explain themselves

- **WHEN** 板的 agents 数与页脚状态条的「N 个 agent 在役」不相等
- **THEN** 板上有一行口径说明指出两者的统计范围不同，读者不会将其理解为数据错误

#### Scenario: Absent runner stats says where to look

- **WHEN** 窗口内无 `runner_stats`
- **THEN** 该区块给出「为什么空/去哪看」的说明，而不是仅一句「窗口内无 runner_stats」

### Requirement: Fleet card actions are layered, behavior unchanged

舰队卡的管理操作 SHALL 分层呈现：主操作留在卡面，其余收进卡内「更多」入口。**每一个管理面板的
行为、端点与测试标识 SHALL 保持不变**，暂停/恢复与对话入口 SHALL 始终在卡面可达。

#### Scenario: Primary actions stay on the card

- **WHEN** 部署者查看一张舰队卡
- **THEN** 暂停/恢复与对话入口在卡面直接可达，其余管理入口经一次展开后可达且行为与分层前一致

#### Scenario: Every panel still opens

- **WHEN** 部署者从分层后的入口打开配置/记录/记忆/额度/嵌入/允许清单任一面板
- **THEN** 该面板的行为、端点调用与测试标识与分层前完全相同

### Requirement: Visitor-facing labels are human-readable without hiding unknowns

公开目录与 agent 详情的标签 SHALL 经一张人读字典渲染已知的内部枚举（线标记与内部状态类标签，
例如 `wire`、`lex`、`facet`、`yizuo`、`security-pending`、`M2`）。字典未命中的标签 SHALL 原样呈现，
**SHALL NOT 被吞掉或替换为占位**。

当 agent 未声明示例问句时，卡片与详情页 SHALL 呈现一个不残缺的形态（给出下一步：直接对话／看对接
文档），SHALL NOT 留下空段落或「（未声明）」式的残缺表达。

#### Scenario: Known internal label renders human-readable

- **WHEN** 目录卡携带标签 `security-pending` 与 `wire`
- **THEN** 两者都以访客可读的中文呈现，原始值保留在可达说明里

#### Scenario: Unknown label passes through untouched

- **WHEN** 目录卡携带一个字典未命中的标签
- **THEN** 该标签原样显示，不被丢弃也不被替换

#### Scenario: No examples is not a hole

- **WHEN** 一个可对话 agent 未声明 examples
- **THEN** 卡片与详情页不出现空的示例段落或「（未声明）」，而是给出直接对话入口与文档指引

## MODIFIED Requirements

### Requirement: The console is organized into fleet, missions, and ops tabs

The deployer console SHALL organize its surfaces into the following switchable tabs — 我的舰队
(deployments management with its config/allowlist/usage/allowance panels, the plan statement, and the
deploy wizard with earnings), 我的任务 (the mission list, creation, and detail), 桌面机位 (the paired
device seats and their mailbox), 消耗 (the usage/stats views with the daily series chart), and 运维面
(the fleet board, the per-agent timeline, and the ops plan manager) — every panel's behavior, endpoint
usage, and test identifier unchanged by the reorganization. Tab data SHALL load when its tab is shown
(the board's polling runs only while the ops tab is active). The console's deep-link contract SHALL keep
`#/console/<slug>` opening that deployment's config panel on the fleet tab, and SHALL additionally
reserve `#/console/missions`, `#/console/devices`, `#/console/stats`, and `#/console/ops` as tab routes
(deployment slugs cannot collide — they carry the packs- prefix).

#### Scenario: The three tabs carry the console's surfaces

（场景名沿历史称谓保留；本条已扩为五个 tab。）

- **WHEN** a signed-in deployer opens the console
- **THEN** the fleet tab renders the deployments with their management panels, the statement, and the
  deploy wizard with earnings; the missions tab renders the mission surface; the devices tab renders the
  device seats; the stats tab renders the usage views and the daily chart; the ops tab renders the board,
  timeline, and plan manager — each panel behaving exactly as before

#### Scenario: Deep links still land where they landed

- **WHEN** a visitor opens `#/console/<some-packs-slug>`, `#/console/missions`, `#/console/devices`,
  `#/console/stats`, or `#/console/ops`
- **THEN** respectively the fleet tab opens with that deployment's config panel, and the missions /
  devices / stats / ops tabs render

#### Scenario: Polling follows the tab

- **WHEN** the ops tab is not active
- **THEN** the board's periodic polling does not run; opening the tab starts it

### Requirement: The fleet tab renders deployment cards

The fleet tab SHALL render the deployments as cards — each card answering the cockpit's three questions
at a glance: health (a single status badge per the cross-surface vocabulary, with visibility), recent
activity (近 7 天回合数), and cost watermark (30-day minutes and settled value), plus the chat allowance's
remaining minutes when set — beside a chat link and the existing management actions (config / records /
allowance / allowlist / pause-resume) with their management panels opening in the right-side drawer, the
management actions layered so the primary ones stay on the card. An unavailable summary degrades the
cards' signal columns honestly (placeholder, never fake zeros), and an available all-zero summary speaks
as one empty-state sentence rather than three zeros. The compact slug detail stays reachable from the card.

#### Scenario: A card answers without a manual

- **WHEN** a deployer opens the fleet tab
- **THEN** each deployment card shows exactly one status badge, 7-day turn count, 30-day minutes and
  value, and allowance remainder at a glance

#### Scenario: Management stays one click away

- **WHEN** a deployer acts from a card
- **THEN** the existing config / records / allowance / allowlist panels and pause-resume operate exactly
  as before the cards, reached directly or through the card's "more" entry

#### Scenario: A card never wears two status badges

- **WHEN** a deployment has a failing health entry
- **THEN** its card shows the single 「持续失败」 badge and no second, conflicting status chip
