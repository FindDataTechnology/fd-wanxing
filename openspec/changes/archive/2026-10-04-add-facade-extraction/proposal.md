# Proposal: add-facade-extraction

## Why

萬星独立运行 program 切片②（L2 拆面 + L1 域名）：facade 从 paas gateway 的挂载模块
升格为萬星平面自己的部署单元——独立进程、独立镜像、独立滚动，不再随壹座 gateway 一起
动；对外换上 `wanxing.finddatatech.cloud` 自有域名（L1）。这是 ADR-0001「部署面独立」
的第一步落地。

## What Changes

- **代码迁入**：paas `gateway/wanxing/`（core/a2a/store/bookkeeping/fleet-report/routes）
  与其唯一代码依赖 `lib/sub2api-admin.js` 迁入本仓 `services/wanxing-facade/`，带独立
  entry（env 同名平移，compose/k8s 配置机械照搬）。迁移携带切片①的快照缓存与③的上报
  接线（paas 工作树上已实现）。
- **规格 fork**：paas `wanxing-facade` spec 连同切片①的 delta 效果 fork 入本仓 specs
  （迁入版=当前文本+①已应用）；paas 侧在切换完成时标 moved（随 paas 侧摘除 change）。
- **镜像与发布线**：本仓 Dockerfile（node bookworm-slim 多阶段，better-sqlite3 原生
  构建）+ GHA→TCR 双镜像（`yizuo/wanxing-facade`、`yizuo/fleet-observer`——后者补齐
  add-fleet-event-backbone 6.1 的镜像半）。
- **部署面**：`deploy/` 交付 facade + fleet-observer 的 Deployment/Service/PVC/Ingress
  清单（wanxing 域名 → facade；envFrom 破折号键坑以显式 secretKeyRef 规避）。
- **上报切换点修订**：facade 与 fleet-observer 同为萬星平面内**各自独立**的服务——
  settled/admitted/refused 继续走 fleet-report 跨进程上报（at-least-once + 确定性 id
  已验），不做「同进程直写」合并（扩缩容解耦，program 原切换点注记据此修订）。

## Capability Impact

- 本仓新增 `wanxing-facade` capability（fork 自 paas，含①效果）+ 本变更加
  「独立部署单元」requirement（/healthz、env 契约、无壹座 gateway 依赖）。

## Non-goals

- paas gateway 摘除（切换完成后另立 paas 侧 change：routes 摘挂 + spec 标 moved）。
- 域名 DNS/GitOps 实际落子与 fd-prod 上线（部署窗口动作，清单化在 tasks）。
- runner 迁入（facade 之后，program 原序）；web 门面（切片⑤）。

## 验收口径

迁移后的 facade 在本仓独立起服：facade 套件（32 用例）+ bookkeeping 套件（7 用例）
全绿；镜像双构建可推 TCR；staging 一轮「目录/卡片/A2A 回合/结算」四点冒烟 + 切流后
`wanxing.finddatatech.cloud` 同四点复测。
