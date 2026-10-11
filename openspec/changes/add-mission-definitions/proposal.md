# add-mission-definitions

## Why

M2 场景A（roadmap：docs/facet-wanxing-roadmap.md，2026-10-11 立项）的第一块产品面：把「目标 + 模型 + 时间窗 + 成本上限」四元组变成萬星的一等公民。基建四期（任务引擎/执行槽/委派/预算 C1）、C5 套餐、通知 C3、机群观测已全部在役，planner 形态已定案（agent 路线，见 roadmap 已定决策表）——唯一缺的是 planner 要消费的任务定义本身：现在客户没有任何地方声明「我要什么、什么时候跑、最多花多少」。这是消费象限最后一格（程序×自主）的地基。

## What Changes

- **mission 存储**：wanxing-facade 新表 `wanxing_missions`——每条 mission = owner（console 用户）+ 四元组（goal 文本 / model / 时间窗 start~end / costCapMinutes）+ 显式状态机 + planner 产出物（plan 步骤数组 / 最终报告）+ 成本累计（派生）。
- **状态机一等**：`draft → submitted → planning → awaiting_approval | auto_approved → scheduled → executing → reported | failed | aborted`。审批模式 mission 级声明（人批 or 自动）；owner 与 ops 可 abort；每步转移带时间戳与触发者。
- **owner API + console 面板**：`/api/wanxing/v1/console/missions` CRUD + approve/abort（身份沿 console 会话；ops 门沿 serving-plans 先例）；wanxing-web ConsoleView 新「我的任务」面板（状态/计划/成本累计/报告）。
- **planner 派发契约**：facade 以服务身份向配置的 planner agent（`MISSION_PLANNER_SLUG`，部署的 pack agent）发一回合 a2a 消息（mission brief + 一次性回写 token）；planner 经 `/api/wanxing/v1/missions/:id/writeback`（token 门）回写 plan / 步骤状态 / 报告。本 change 只交付契约与通道，planner pack 本体是下一个 change。
- **mission 成本闸**：回合记账挂 mission 维度（usage 加 mission 列，派发链路透传 mission id）；`已记分钟 ≥ costCapMinutes` 时拒绝继续派发（402 MISSION_EXHAUSTED，形状沿 C5 planGate）；结算路径不变（既有瀑布/部署键），cap 是派发闸不是新结算器。
- **观测事件**：mission 生命周期每次转移发 fleet 事件（沿 a2a face 的 report 通道），board 侧聚合视图留给后续 change。

## Capabilities

### New Capabilities

- `mission-definitions`: 任务四元组存储与状态机、owner/ops API 与 console 面、planner 派发契约与回写通道、mission 级成本闸与生命周期观测事件。

## Impact

- **代码**：`services/wanxing-facade/`（store.js 建表+mission CRUD、新 missions.js 模块挂 routes、core.js 记账挂 mission 维度、a2a 派发通道、console.js 面）、`wanxing-web/`（ConsoleView 面板）、`scripts/test-wanxing-missions.mjs`（新）。
- **复用**：C5 planGate 形状（core.js 402 先例）、a2a 车道 upstream 通道（a2a.js agentUrlFor/forwardHeaders）、fleet report 通道、console 会话与 ops 门（console.js）。
- **不做（后续 change）**：planner pack 本体（persona+规划技能，②）、夜间车道的 lane 路由与 checkpoint 长程续跑（③）、fleet board mission 视图（④）。

## Non-goals

- 不建独立规划服务、不建外部 MC console（形态已定案，见 roadmap）。
- 不改结算路径：mission cap 是派发闸；每回合结算仍走既有瀑布/部署键。
- 不做时间窗内的 lane 级降费路由（sub2api 车道×时段）——时间窗 v1 只约束派发时段。
