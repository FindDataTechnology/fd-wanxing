# add-plan-requests-and-move-statement

## Why

clarify-plan-card-and-wizard 归档时留案的两项信息架构欠账：①「API 调用对账」卡仍长在
「我的舰队」里，而消耗信息的天堂是「消耗」tab（三口径对账已在那）——调用方经济该归位；
②套餐开通仍是「找运维靠喊」——serving-plans 是 ops-only 发放，调用者没有任何控制台内的
自助入口，申请-审批全在线下。

## What Changes

- **对账卡迁移（web）**：「API 调用对账」卡从「我的舰队」挪到「消耗」tab 顶部（三口径
  卡之上），舰队页原位不再渲染；测试键（`my-statement-panel` 等）随卡走。
- **套餐自助申请-审批（facade + web）**：
  - 调用者经控制台提交套餐申请（期望分钟上限 + 备注），可查本人申请列表与状态；
  - ops 令牌在运维面看到待审队列，一键批准（批准即经既有 ops-only 发放路径落 plan）或
    驳回（带备注）；
  - 发放语义不变：**只有 ops 能落 plan**——申请是「把喊运维变成控制台里的队列条目」，
    不是自助购买。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities
- `console-economics-clarity`: 对账卡的位置要求从「舰队视图内」改为「消耗视图内」（标题/
  释义/数字行为要求不变）。
- `serving-plans`: 新增「套餐申请」需求——申请者自助提交与查询、ops 审批（批准=经既有
  发放路径生效）；既有 ops-gated 发放需求不动。

（姊妹在途 change 只占 `wanxing-facade`/`wanxing-web`/`copilot-intent-adherence`，上述
两能力无冲突写者，可安全 MODIFIED。）

## Impact

- facade：`store.js`（`wanxing_plan_requests` 表 + 请求 CRUD）、`console.js`（申请路由
  三条：POST 自助、GET 双视角、PUT 审批 ops-only）。
- web：`FleetView.jsx`（撤卡）、`StatsView.jsx`（收卡）、对账卡内「申请套餐」入口、
  `OpsView.jsx`（待审队列）。
- 出片：facade + web 双镜像同车。

## Non-goals

- 自助购买/支付（从 key 余额直接购分钟）与自动审批——申请-审批先落地，购买视使用情况
  另立 change。
- 套餐模板/档位商店化（首版仅输入分钟数，UI 给三档建议值）。
- 对账卡与消耗三口径的口径合并（caliber 分离纪律不动）。
