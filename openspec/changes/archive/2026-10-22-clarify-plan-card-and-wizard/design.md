# Design — clarify-plan-card-and-wizard

## Context

纯展示层微刀（见 proposal Why——2026-10-22 用户真机反馈「看不懂」）。两处现有代码：
`FleetView.jsx` 的套餐卡（`my-statement-panel`）与 `DeployWizard.jsx` 的步骤条/勾选/
计费步。无 API 变更、无 facade 变更、无数据迁移。

## Goals / Non-Goals

- Goals：三处文案/提示在正确的时机出现（卡上释义、勾选时即警告、向导头备键清单）。
- Non-Goals（proposal 已列）：跨 tab 迁移、套餐自助入口、向导表单降门槛。

## Decisions

1. **改名而非挪位。** 「API 调用对账」保留在「我的舰队」内（部署者也是潜在调用方，
   一屏可见经济全貌）；跨 tab 挪动属信息架构调整，等文案验证后另议。
2. **规则前置=复用既有警告文案的时点迁移。** 第 2 步勾选 >1 时渲染与第 4 步同源的提示
   （同一字符串常量，两处引用），第 4 步原警告不动——避免两处文案漂移。
3. **准备清单放向导头部常驻。** 一行 + 计费面板链接（复用第 4 步已有的
   token.finddatatech.cloud 链接常量）；不做弹窗打断。
4. **不动 data-testid 既有键。** `my-statement-panel`/`my-statement-body` 等测试锚
   原样保留（新文案只加节点不改键），web 无单测但 ego 探针脚本按这些键断言。

## Risks / Trade-offs

- [改名后老用户找不着「我的套餐」] → 卡内释义行明写「即原『我的套餐』」过渡一版；
  下一次迭代再摘。
- [准备清单常驻增加视觉噪音] → 单行小字，置于步骤条上方，不占操作位。

## Migration Plan

单镜像（wanxing-web）出片滚产即可；回滚=回滚镜像。验证走 stub dist 浏览器实测 +
生产真机眼见（同 fix-fleet-scope-and-owner-gates 的 2.4/3.1 配方）。

## Open Questions

无。
