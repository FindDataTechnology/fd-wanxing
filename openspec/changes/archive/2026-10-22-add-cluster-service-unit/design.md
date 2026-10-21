# Design — add-cluster-service-unit

## Context

per-agent 门（a2a.js）的回合管线：key 门 → 协议形状 → agent 准入（`core.admit`：存在 / paused /
私有 allowlist）→ plan 门 → RPM → 幂等分流（replay / join / new）→ (caller, agent) 槽 → 转发
`config.agentUrlFor(agentPath)` → 结果口径（答案而非 HTTP 状态）→ `recordUsage` → `trySettle`
（plan 抽取 / 余额扣减 + 部署者分成）→ 回调 → fleet 事件。成员是独立 served 部署（各自
runner 进程、各自 agentPath），facade 对每个成员的操作只是「再转发一次」。

## Decisions

**D1 组合在 facade，不在 runner。** 成员已是独立 served 部署，集群回合 = 多次转发 + 聚合；借用
契约不变、runner 零改动。与壹座 cron-runner 的扇出语义对称，但并发是真的（无共享 dsh 运行时的
串行约束）——这是萬星比壹座更适合跑小队的结构性原因。

**D2 独立路由前缀，不占扁平 slug。** per-agent 处理器以 `resolveDeployment` 为真相，集群不是
部署；若把单位塞进 `/a2a/:slug` 就得在处理器里分叉。`/a2a/cluster/:clusterSlug` 段数不同，
Express 的 `:agentSlug` 单段匹配天然不碰它；消费者按 URL 形状分流。单位 slug = `slugFor(packId)`
（小写化与 agent slug 同一风险面，已接受）。

**D3 单位在列规则 = ≥1 默认成员在役**；回合准入**逐成员**、≥1 才跑。部分小队如实可见
（`members[].served`），缺席成员在卡与列表里是 `served: false` 而不是消失。与壹座
`resolveClusterMembers`（skip 带原因）/「全员 skipped 即失败」逐条对称。

**D4 计费口径 = 成员逐个走账，单位零附加。** caller-pays 每回合不变；部署者分成按成员部署归属
（同 pack 同部署者，`resolveDeployerUser(memberSlug)` 不改）；plan 抽取逐成员；summary 是**多一
个成员回合**（lead 的 slug，显式 opt-in 故可预期）。`cluster_turn_id` 只做关联列，owner usage
视图将来可按它分组。不新增「集群费率」——单位不是一个 agent，没有自己的分钟。

**D5 幂等两层。** 复合键在 `clusterSlug` 上走 `idempotentSend`（存复合响应；replay 不跑任何
成员；并发重复 join 同一 flight）。成员派生键 `<key>--<agentId>` / `<key>--summary` 各自走
`idempotentSend(memberSlug)`：复合中途崩溃后重放，已完成成员从台账重放（不新增行），未完成的
重跑。无 Idempotency-Key 时两层都退化为 new（与 per-agent 一致）。

**D6 并发槽两层。** (caller, 单位) 槽拒绝并发复合（409 TURN_IN_FLIGHT）；成员槽沿用
`acquireSlot(caller, memberSlug)`——若调用方同时在直调某成员，该成员本轮 `skipped:
TURN_IN_FLIGHT`，不阻塞整单位。RPM 只计一次：调用方只发了一个请求。

**D7 聚合缺省 `all`。** 对 API 消费者最透明（每个成员一节）；`summary` 额外计费故显式 opt-in；
`first` 在并行下取最先成功完成者（`Promise.any` 语义，其余成员照常完成并各自计费——不取消，
因为取消会把已跑的成员回合变成不可计费的半成品）。

**D8 上下文。** 调用方 `context_id` 缺省派生 `wx:<hash(idemKey)>`（同 per-agent）；成员上下文
= `<ctx>--<agentId>`，保留 `wx:` 前缀与 reap 段，runner 的回收逻辑原样适用。调用方复用
`context_id` ⇒ 每个成员各自续谈。

**D9 错误口径。** 成员 JSON-RPC error / 不可读 / 超时 → `status: error`，其行 `outcome: error`
waived（沿用 fix-error-turn-billing）。全员 error → 复合答 JSON-RPC error
`-32040 CLUSTER_ALL_FAILED`，`metadata.cluster` 仍带（成员各自 waived，总计费 0）。

**D10 卡的形状。** 用 A2A AgentCard 既有字段表达单位：`skills[]` 每在役公开成员一条
（`id` = agentId、`name`、`description` = 成员描述、`tags` 含 role），`capabilities.streaming:
false`，`url` = 单位路由；扩展块 `cluster` 携声明、策略与 `aggregations: ["all","first","summary"]`
——A2A 容许扩展字段，既有卡消费者忽略即可。

## Risks

- `first` 不取消落后成员 ⇒ 调用方按 `first` 仍可能被计 N 个成员的分钟；卡与 docs 明示。
- 并行成员同时打同一外部工具（柏讯 MCP）可能触发上游限流——成员回合各自报 error 即可，复合
  如实脚注；若真机频发，调低 `maxConcurrentRuns`（声明侧，pack 作者可控）。
- `summary` 的 lead 选择是「声明序首个成功的默认成员」：若默认成员全失败而可选成员成功，没有
  lead ⇒ 回落 `all` 并注明——与壹座「无本地成员产出则回落 digest」同一语义。
