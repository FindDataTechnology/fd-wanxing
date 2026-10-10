# Proposal: add-serving-plans

## Why

萬星对外服务的计价层（探索案 G5，唯一未闭合缺口）：API 车道现在只有"裸余额扣减"一种结算——调用者必须先在 sub2api 充值，平台无法售卖预付时长套餐、无法给内部/伙伴调用者发额度，账面也无法区分按次付费与套餐消费。chat lane 已树立补贴瀑布模式（facade 权威账 + settler 分离），API 车道补齐同构套餐层后，"目标 + 模型 + 时间窗 + 最多成本"的成本语义才完整（facet-wanxing-roadmap M1 的唯一萬星项，grill Q5 已定：按时长分钟取整/即时结算/facade 账本/欠费下回合拒）。

## What Changes

- 新增 **serving plans**：调用者（sub2api key 持有者）维度预付时长套餐——分钟上限、v1 平价计费；运营经 console 发放/调整（先不做支付，沿充值码/手工先例）。
- **准入门扩展**：key 探活仍是身份/有效性门不变；有活跃套餐的调用者另需套餐余量 > 0，耗尽即结构化拒绝（plan-exhausted），调整后下回合恢复。
- **结算选举**：回合完成时——有活跃套餐 → 套餐分钟扣减（facade 账本权威、按 usage 行幂等）；无套餐 → 既有 key 余额扣减路径原样（向后兼容，lexdemo 等存量调用者零感知）。
- **账面**：usage 行携带 settler=plan；余量 = 上限 − 已结算分钟，账本派生（沿 host-allowance 模式，无计数器漂移）；对账面新增套餐维度。
- **sub2api 虚拟用量镜像降级为非阻塞子项**：契约写进 design（幂等、admin 鉴权），择机递交上游（Wei-Shaw/sub2api）。
- v2 明确不做：模型车道分档计价（set_model 档）、套餐过期/结转、支付自助。

## Capabilities

### New Capabilities

- `serving-plans`：套餐生命周期（发放/调整/余量派生）、准入余量门、套餐结算与耗尽语义、管理面与对账面。

### Modified Capabilities

- `wanxing-facade`："Admitted turns are metered and settled at the boundary" 扩展结算选举（套餐扣减 vs 余额扣减），新增套餐结算场景；其余 requirement 不动。
