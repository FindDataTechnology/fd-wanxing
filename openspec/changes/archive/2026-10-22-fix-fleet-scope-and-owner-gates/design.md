# Design — fix-fleet-scope-and-owner-gates

## Context

三处现状（详见 proposal Why，2026-10-22 生产真机实证）：

- `console.js` `/console/deployments` 枚举台账全部行，不按身份过滤；卡片的管理动作里
  只有 usage / host-allowance / embed-settings / config 代理过 deployer-or-ops 闸。
- `pauseAction` 与 callers 读/增/删只过令牌-或-身份的 `gate()`，无归属校验——任何登录
  身份可暂停他人部署、读写他人白名单。
- `FleetView.jsx` 的 `loadConfig/loadCallers/loadAllowance/loadEmbed` 失败只写
  `cfgNote/alNote/alwNote/embedNote`，而这些 note 仅在对应面板内部渲染——面板没打开，
  错误等于从未显示。

## Goals / Non-Goals

- Goals：归属语义一处收口（列表过滤 + 动作全闸）；web 拒绝/失败必可见且分型。
- Non-Goals（proposal 已列）：套餐卡与向导的产品层重排；packs 侧 config 代理校验
  （已正确）；ops 视角任何变化。

## Decisions

1. **过滤做在 facade，不做在 web。** 单点收口、API 不再向普通身份泄露他人部署的
   slug/agentPath/packId；web 过滤方案被否（接口仍泄列）。
   `rows()` 已带 `deployedBy`，过滤是 `gate()` 后一行 `filter`；无 `deployedBy` 的行
   （ops-seed 时代部署，实测在册）只对 ops 令牌可见。
2. **pause 与 callers 复用既有 `ownerGate`。** 同一 helper、同一语义（lowercase 邮箱
   比较、ops 豁免），不再造第二套；callers 的读也收口——他人白名单里的调用者邮箱
   属 PII 面，当前读 200 是泄露口。
3. **web 错误反馈按卡片键控。** 每卡动作行下方渲染 per-card note（state 按
   `slug:action` 键控），不再复用全局 `depErr`（多卡并发会互相覆盖、且离按钮太远）。
   状态码分型在前端做：403 → 「非本人部署」归属文案；5xx/网络 → 可重试文案；顺带修正
   记录面板「这不是『没有调用』，请稍后再试」对 403 的误导。
4. **不加 env 回滚杆。** 改动小且越权路径本就该关；回滚 = 回滚镜像。若上产后发现真实
   依赖越权路径的消费方（目前没有），再议。

## Risks / Trade-offs

- [老用户舰队列表突然变短，误以为部署丢了] → 空态文案明确「名下暂无部署」并指向下方
  部署向导；ops 面不受影响。
- [deployedBy 大小写漂移误伤] → facade 侧统一 lowercase 比较（现状）；packs 侧 config
  代理是严格 `!==`，Logto 邮箱与台账大小写不一致时会出现「facade 过、packs 拒」——
  实测罕见（真机本人卡 200），保持现状不改（Non-goal）。
- [fleet summary 信号列与卡片数不一致] → summary 端点不动，前端按卡片查键，多余键自然
  不渲染。
- [允许清单读收口后「代客排障」路径破] → 运营/排障走 ops 令牌，行为不变。

## Migration Plan

1. facade + web 两镜像同车构建滚版（fd-build-snapshot，源仓先推 origin）。
2. 上产后三线验证：他人卡 403（含 pause 与允许清单）；本人卡全按钮绿；ops 令牌 API
   实探全量不变。
3. 回滚：两镜像回退即可，无数据迁移、无 schema 变更。

## Open Questions

无（可延后项均已在 Non-goals 框死）。
