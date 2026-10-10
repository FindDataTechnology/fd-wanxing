# Design: add-serving-plans

## Context

见 proposal.md - Why。现状锚点：facade 六表在位（`wanxing_usage` 行含 `minutesBilled`/`settlementStatus` 含 waived 态、`wanxing_host_allowance` 已示范"上限−账本派生余量"模式）；结算钩子 `onTurnComplete` + pending sweep 幂等重试成熟；chat lane 的补贴瀑布（settler 分离）是本变更的直接同构先例。grill Q5 已定：按时长分钟取整 / 即时结算 / facade 账本 / 欠费下回合拒——本设计不重开。

## Goals / Non-Goals

**Goals:**
- 调用者维度预付分钟套餐：发放/调整/余量/耗尽/恢复全链，运营经 console 管理。
- 结算选举：plan → 本地账本扣减；无 plan → 既有余额扣减原样。
- 账面可对：settler=plan 的 usage 行 + 派生余量 + 调用者对账面。

**Non-Goals:**
- 支付自助（充值码/手工先例）；模型车道分档计价（v2 set_model 档）；套餐过期/结转；chat lane 任何改动；sub2api 镜像的**实现**（契约先立、非阻塞）。

## Decisions

- **D1 套餐模型**：per-caller 单活跃套餐，字段 = 分钟上限 + 备注 + 创建者；v1 无有效期、无结转（余量=上限−已结算，调整上限即充值/回收——与 host-allowance 的 set/adjust 同构，复用其权限语义但主体是 caller 不是 agent）。
- **D2 结算选举**：`onTurnComplete` 落 usage 行时解析 settler——caller 有活跃套餐 → `plan`（本地扣减，不触 sub2api）；否则 → 既有 balance 路径。幂等键 = usage 行 id（与现行 hostSettle 的确定性 id 同一纪律）。plan 路径无外部调用故无 retry-then-suspend 分支；waived 语义保持在前。
- **D3 准入门**：key 探活（身份/组/配额）不动；活跃套餐者加查派生余量 > 0，耗尽 → 结构化 402 形错误 `plan_exhausted`（文案给"联系运营调整"指引），调整后自动恢复（无挂起态可清——比 suspend 语义简单）。
- **D4 管理面权限**：ops 凭据专享（console token/Logto 双门禁的既有 ops 面）；deployer 不管别人的套餐。发放/调整走既有 console 管理动作模式（部署列表/暂停恢复同款）。
- **D5 账面**：新表 `wanxing_plans`（caller 键、cap、created_by、note、时间戳）；usage 行加 `settler` 与 `plan_ref` 可空列（迁移：ALTER IF NOT EXISTS，存量行默认 balance 语义）；调用者对账 = 按 settler 聚合 + 派生余量，键引用沿用掩码纪律（≤4 尾字符）。
- **D6 sub2api 虚拟用量镜像（非阻塞）**：契约为 `POST /api/v1/admin/usage`（body：`{external_id, user_id, minutes, note}`，`external_id` 幂等键 = facade usage 行 id，admin 鉴权），目的=让调用者 sub2api 面板同步显示消费；递交上游 Wei-Shaw/sub2api 为独立后续动作，v1 上线不依赖它。

## Open Questions

- 计价配置面：分钟单价（或"套餐即分钟数、不涉金额"）v1 是否需要 config 键？——倾向 v1 套餐纯分钟数、无金额字段（对账走发放记录），金额层留给 v2 分档时一并引入。
- 对账面放 wanxing-web 何处：token 控制台新 tab vs 部署者记录面扩展——实现期按现有 console 信息架构就近落，不新开导航。

## Risks / Trade-offs

- 结算选举分叉增加账面阅读成本 → settler 列 + 对账面双维度呈现，一屏可分。
- 余量派生查询随 usage 行增长 → 沿 host-allowance 的有界查询模式（按 plan_ref 索引聚合），量大再 rollup（fleet-observability 先例）。
- ops 手工发放无自助 → 与既有充值码先例一致，v2 支付自助前不扩。
