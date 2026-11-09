# 设计：让坏掉的 agent 自己浮出来

## Context

见 proposal.md 的 Why。设计必须容纳的既有事实：

- **信号已经在库里**：`rollup_agent_hour(hour, agent, turns, errors, minutes_billed, usd, wake_p50_ms, wake_p95_ms, budget_kills, paused_minutes)` 由 rollup 每 60s 重算，保留 14 天；board 一次读 24 个小时键（`services/fleet-observer/observer.js:322`）。
- **board 已有累计量但无持续性**：`turns` / `errors` 是 24h 汇总，一个 agent 偶发失败与持续失败在面板上不可分。
- **既有事件主干**按 kind 索引，`kindSince([...])` 取有界窗口；边沿事件适合走这条面，不适合进 rollup。
- **暂停态不在万星库里**：`paused` 在 registry 条目 `metadata.paused`，observer 侧已通过 `entryFor`/agentState 一类路径可读（facade 的 a2a face 就是这么做的）。
- **既有告警投递**（2026-11-08）消费的是差量事件，且已确立"缺数不算恢复"的口径——本 change 沿用，不重定义。

## Goals / Non-Goals

**Goals**
- 一个 agent 若持续失败，**在面板上自己排到前面**，不需要有人主动去查。
- 失败原因随信号一起走，看到徽标就知道该去查哪一层。
- 阈值可解释、可回测：用 2026-10-22→11-10 那段真实数据当校准样本。

**Non-Goals**
- 不做告警通道、不做自动处置（见 proposal Non-goals）。
- 不引入逐回合存储，不新增表。

## Decisions

### D1 健康态用「三态分离 + 持续性」，不用失败率

四态：`ok | degraded | silent | failing`。

- `silent`（窗口内 `turns == 0`）单独一类。**不是健康**，也**不是故障**。理由是实测：扫 6 个 reception 部署，4 个零回合，若把它们当故障会立刻制造 4 条假红；若当健康又掩盖了"部署了但没人用"。
- `failing` = 有回合且 `errors == turns` 且连续失败小时数 × 该 agent 平均每回合 ≥ `FAILING_MIN_CONSECUTIVE`。
- `degraded` = 有成功有失败且失败率 ≥ `DEGRADED_ERROR_RATE`（默认 0.3）。
- 其余 `ok`。

**为什么不用纯失败率**：低流量下 1 次失败 = 100%。`silent` 与"1 回合失败"必须靠绝对量而不是比例区分。

**备选**：按"距上次成功的时间"判定。否决——它把"没人调用"和"一直失败"混为一谈，正是要修的病。

### D2 阈值是独立常量，不从轮询周期派生

`FAILING_MIN_CONSECUTIVE`（默认 3）、`DEGRADED_ERROR_RATE`（默认 0.30）、`HEALTH_WINDOW_HOURS`（默认 24）三者各自独立，全部 env 可调。

**为什么**：上一轮踩过"用上限派生豁免阈值 → 策略空转"（10min 上限 vs 小时级 cadence）。阈值表达的是**耐心**，不是周期。用 19 天全失败当校准样本：任何"全失败 + 连续 3"都能抓住它，同时对偶发失败不敏感。

### D3 暂停豁免：`paused` 优先于一切

`metadata.paused === true` 的 agent 直接判 `paused`（不进入 ok/degraded/failing），且**不计入告警**。

**为什么**：暂停是合法静止。把暂停当故障会让每次维护都触发告警，告警一旦噪音化就没人看了——这和"19 天没人发现"是同一个终局。

**代价**：一个被误标暂停的坏 agent 会隐身。缓解：面板上 `paused` 单独可见（不是隐藏），运维能看到"这个部署是暂停的"。

### D4 一次跃迁一条事件，不是每回合一条

`agent_unhealthy` 只在 `previous_health != failing && current_health == failing` 时写入，恢复时写 `agent_healthy`。事件载荷带 `{ agent, since, consecutive, last_error_kind, window_hours }`。

**为什么**：告警通道消费的是差量；每回合一条会把通道打爆，且"缺数不算恢复"的口径要求恢复也要成对出现。

**状态存在哪**：observer 内存（`Map<agent, {health, since}>`）+ 重启后由 rollup 重算一次，不新增表。代价是重启后可能重复发一次跃迁——用 `since` 相同去重即可（同一 `since` 不重发）。

### D5 错误归类从既有事件取，取不到就 `unknown`

`last_error_kind` 由最近失败回合的事件载荷推导（`cold_start` / `upstream` / `rate_limited` / `budget` / `unknown`）。

**为什么**：本轮的真因（`-32004 cold start ... 404`）只有抓原始 SSE 才看得到，而这条信息其实已经在事件流里。不归类的话，徽标只能告诉你"坏了"，不能告诉你"坏在哪一层"。

**注意**：`unknown` 与"无错误"必须可区分（`ok` 时该字段为 `null`，不是 `"unknown"`）。这是"读不到当成不存在"那个老病的反向版本。

### D6 board 只增字段，旧消费者不受影响

`/api/fleet/v1/board` 新增 `agent_health: [{ agent, health, since, consecutive, last_error_kind, window_hours }]`，按 `failing > degraded > silent > ok` 排序。既有字段语义不动。

**为什么**：board 有多个消费者（控制台、运维面、外部看板适配器）。只增字段意味着任一消费者晚一拍升级都不会炸。

## Risks / Trade-offs

- [阈值噪音化 → 又没人看] → 用真实数据回测：拿 10-22→11-10 的 rollup 跑一次，要求识律那条被判定为 `failing`，且当期正常 agent 零误报；两个方向都要有用例。
- [低流量 agent 被误判] → `silent` 独立成态且不告警；`failing` 要求绝对连续量而非比例。
- [observer 重启重复发事件] → `since` 去重；恢复事件同样按 `since` 配对。
- [registry 不可达时判不出 paused] → 该 agent 本轮跳过判健康（保留上次结论并标 `stale`），**不**当作 ok；宁可沉默也不误报。
- [新增事件 kind 被旧版 observer 丢弃] → 先确认未知 kind 的落库行为；若丢弃，事件 kind 需与 observer 版本同批上线。

## 迁移计划

1. 派生模块 + 单测（含回测用例），只加读面，不影响现有响应。
2. board 增字段 → 控制台与运维面接徽标（两个面可分别上线）。
3. 边沿事件切换到告警投递，先只观测不投递一轮，确认噪音水平后再打开。

**回滚**：1-2 各自独立回退（删字段/删徽标）；3 关掉事件写入即回到"只有面板"。

## Open Questions

- 告警收件人与频控沿用五线告警的现有口径（1253774197@qq.com、静默窗），还是给 fleet 健康单独一份？——留待接告警那一步再定，不影响本 change 的代码面。
