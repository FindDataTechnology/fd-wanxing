# clarify-plan-card-and-wizard

## Why

用户 2026-10-22 真机走查反馈：「我的套餐」和「部署我的 agent」看不懂怎么用。两个可懂性
断点：①「我的套餐」实为**调用方**侧的 API 对账单（套餐由运维发放、无套餐按调用键余额
扣费），却以部署者口吻的名字放在「我的舰队」里，被误读为「我部署的服务的套餐」；②部署
向导的「一个计费键只绑一个 agent」规则只在第 4 步勾多个后才以警告出现，用户走到最后一步
才被拦，且「先去计费面板建 sk- 键」这一前置动作没有在向导开头亮出来。

## What Changes

- **套餐卡改名+释义**（web）：「我的套餐」→「API 调用对账」，卡内补一行说明——你是调用
  方视角、套餐=平台发放的包月额度（找运维开通）、无套餐时按调用键余额实扣。
- **向导规则前置**（web）：「一键一 agent」规则提前到第 2 步勾选界面——勾选数 >1 时即时
  提示需为每个 agent 各备一个 sk- 键分批部署（第 4 步警告保留为兜底）。
- **向导前置清单**（web）：向导头部亮出准备项——「先在计费面板（token.finddatatech.cloud）
  创建至少一个 sk- 计费键」，带链接。

## Capabilities

### New Capabilities
- `console-economics-clarity`: 部署者控制台经济面的可懂性——调用对账卡的命名与释义、
  部署向导的规则前置与准备清单。

### Modified Capabilities

（无——姊妹 change `add-cluster-*` 仍在途且占 `wanxing-web` 的 delta，本 change
ADDED-only 规避归档排序死锁，与 fix-fleet-scope-and-owner-gates 同法。）

## Impact

- `wanxing-web/src/views/console/FleetView.jsx`（套餐卡文案）与 `DeployWizard.jsx`
  （步骤 2 即时提示 + 头部准备清单）。
- 纯展示层：无 API、无 facade、无数据变更；出片只滚 wanxing-web 一镜像。

## Non-goals

- 套餐卡跨 tab 迁移（挪去「消耗」）——信息架构级调整，等本刀文案验证后再议。
- 套餐自助购买/管理入口（serving-plans 的 ops-only 语义不动，spec 另有专条）。
- 向导步骤重排或节奏/预算表单的降门槛改造。
