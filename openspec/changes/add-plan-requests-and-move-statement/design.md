# Design — add-plan-requests-and-move-statement

## Context

两件遗留（proposal Why）：对账卡的归属视图；套餐申请-审批的线下化。现网事实：对账卡在
`FleetView.jsx`（`my-statement-panel` 系列测试键）；消耗 tab（`StatsView.jsx`）已是三口径
对账面板；套餐发放=facade `console.js` opsOnly 三路由（GET/PUT `/console/plans`）+
`store.planSet(userId, limitMinutes, updatedBy, note, email)`（`wanxing_plans` 表，user_id
键）。ops 侧登录=服务令牌（ConsoleView 的 token 输入），OpsView 已存在。

## Goals / Non-Goals

- Goals：卡归位到消耗视图；申请→审批全链在控制台内闭环，发放权仍独占于 ops。
- Non-Goals（proposal 已列）：自助购买/自动审批/模板商店化/口径合并。

## Decisions

1. **申请存 facade 新表 `wanxing_plan_requests`**（user_id, email, limit_minutes, note,
   status, decided_by, decided_note, created_at, decided_at），而非复用 `wanxing_plans`——
   请求与发放是两个生命周期（拒绝不发、重复请求排队），混表会把审批状态漏进发放语义。
2. **批准=路由内调 `store.planSet` 后再置 approved**（同事务尽力、先后序：先落 plan 再标
   请求，失败则请求保持 pending 可重批）；请求本身永远不直接产生发放。
3. **GET 双视角**：ops 令牌→全量队列（pending 置顶）；登录身份→仅本人（身份缝=scoping，
   与 statement/earnings 同法）。审批路由 opsOnly，与 `/console/plans` 同一闸。
4. **范围校验**：limit_minutes 整数 ∈ [60, 1_000_000]（与 host-allowance 上界一致）；UI
   给 500/2000/10000 三档建议值 + 自定义输入。
5. **UI 落点**：对答卡迁到 `StatsView` 顶部；「申请套餐」入口=卡内折叠表单（无套餐或想
   调整都可用）+「我的申请」状态列表；OpsView 加待审队列（批准/驳回+备注）。舰队页原位
   撤卡，向导与收益不动。
6. **可选考（未采）**：ops 审批通知推送（信箱/mailbox）——首版不做，OpsView 进面板即见
   pending 计数即可。

## Risks / Trade-offs

- [申请刷屏] → 同身份可见性自限 + ops 队列 pending 置顶；如真出现再上每身份未决上限。
- [批准后 plan 与请求状态不一致] → 先发 plan 再标请求（失败可重批，幂等由 planSet upsert
  保证）；不做跨表事务（sqlite 同库，窗口极小）。
- [对账卡迁移后老用户找不回舰队页入口] → 消耗 tab 与舰队 tab 同级可见；clarify 轮的
  「即原『我的套餐』」过渡语继续承担认知连续性。

## Migration Plan

1. facade（表 + 三路由）与 web（迁卡 + 申请面 + OpsView 队列）同车双镜像滚产。
2. 验证：facade 测试（提交/双视角/审批落地/驳回/越权 403）+ stub dist 浏览器线 + 生产
   真机（aloadtree 提交申请→ops 令牌批准→statement 套餐行变绿）。
3. 回滚：双镜像回退；`wanxing_plan_requests` 表留存无害（无消费者）。

## Open Questions

无（档位建议值与范围界已定为决策 4，可后调不动面）。
