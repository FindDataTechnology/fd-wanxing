# Tasks — clarify-plan-card-and-wizard

## 1. web：文案与规则前置

- [ ] 1.1 FleetView 套餐卡改名「API 调用对账」+ 释义行（调用方视角/套餐=运维发放的包月
  额度/无套餐按调用键余额实扣；含「即原『我的套餐』」过渡语）；`my-statement-panel`/
  `my-statement-body` 测试键不动。验证：stub dist 浏览器实测标题与释义行渲染、数字与
  错误路径不变
- [ ] 1.2 DeployWizard 头部常驻准备清单行（计费面板建 sk- 键，带链接，复用第 4 步链接
  常量）。验证：stub dist 眼见——未选包时即可见
- [ ] 1.3 一键一 agent 规则前置：提取第 4 步警告为共享常量，第 2 步勾选 >1 时即时渲染，
  第 4 步原警告保留。验证：stub dist 勾两个 agent 即见提示、进第 4 步提示仍在
- [ ] 1.4 `vite build` 绿 + 回归：向导既有 testid（wizard-source-*、wizard-pack-row-*、
  wizard-billing-key 等）与流程不受影响

## 2. 出片与真机

- [ ] 2.1 出片滚产 wanxing-web 单镜像（fd-build-snapshot，源仓先推 origin，`--ref` 钉
  本次 commit）；gitee 滚 tag + ArgoCD 硬刷新 + digest 实证；台账 §9 记发布
- [ ] 2.2 生产真机眼见（ego）：对账卡新标题+释义、向导头准备清单、勾选两 agent 即时
  提示、第 4 步兜底警告仍在；留探针输出
