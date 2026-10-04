# Design: add-facade-extraction

## 迁移形态

```
services/wanxing-facade/
  routes.js        ← paas gateway/wanxing/index.js（registerWanxingRoutes 原样，改 import 路径）
  core.js a2a.js store.js bookkeeping.js fleet-report.js   ← 原样平移
  lib/sub2api-admin.js   ← paas lib/sub2api-admin.js 平移（facade 的唯一代码依赖）
  index.js         新：express 装配 + env 引导 + listen（PORT/FLEET_* 同名 env）
```

- env 契约与 paas 挂载期完全同名：`SUB2API_BASE_URL/SUB2API_ADMIN_KEY`、
  `AGENT_SERVING_REGISTRY_URL/TOKEN`、`AGENT_SERVING_BACKEND_TOKEN`、
  `PACKS_INTERNAL_BASE_URL`、`FLEET_OBSERVER_URL/TOKEN`——compose/k8s 值平移即可。
- **登录态面的取舍（实现定案）**：paas 版的 allowlist 管理三路由
  （`/api/packs/:id/deployments/:agentId/callers`）与 ops usage 的 admin 用户分支都骑
  壹座 `resolveUser` 登录态——独立进程没有它。迁移版**不迁**这三条路由（注释指回⑤
  部署者产品页重建），ops usage 只认服务凭据；store 的 allowlist 表与 core 的准入检查
  **原样保留**（运行时语义不变，管理入口暂回 paas 兼容期用）。

## 上报切换点（修订）

原 program 注记「②迁入后改同进程直写」修订为：facade 与 fleet-observer 保持各自独立
部署，fleet-report 跨进程上报保留。理由：observer 是有状态 SQLite（数据根 PVC），
facade 是可水平扩的无状态面——并进程会把扩缩容耦死；at-least-once + 确定性 id 的语义
在跨进程下已验证。Sweep 补报逻辑随 routes.js 平移。

## 镜像与发布线

- 单 Dockerfile、`SERVICE` build-arg 选 entry（facade | fleet-observer），node
  bookworm-slim 多阶段（builder 编 better-sqlite3，runtime 拷产物），国内构建走 aliyun
  apt 源（paas Dockerfile 同法）。
- `.github/workflows/images.yml`：push main 触发，双 job 双 tag
  `ccr.ccs.tencentyun.com/yizuo/{wanxing-facade,fleet-observer}`，org secrets
  TCR_USERNAME/TCR_PASSWORD。**本仓 secrets 需 org 侧配置**（上线清单）。

## 部署清单 `deploy/`

- `wanxing-facade`：Deployment+Service+PVC（wanxing.db 数据根）+ Ingress
  `wanxing.finddatatech.cloud` → facade；A2A 回合 API 同域免 CORS。
- `fleet-observer`：Deployment+Service+PVC（fleet-events.db）；facade env 指其
  Service；runner 侧 env `AGENT_RUNNER_FLEET_URL` 指集群内可达地址（runner 在 cheap1，
  跨节点走 platform 域反代或 tailnet——清单注记，部署窗口定）。
- 坑规避：sub2api 凭据等含破折号/下划线键一律**显式 secretKeyRef**，不用 envFrom
  （fd-prod envFrom 静默跳破折号键前科）；SQLite 数据根挂 PVC + WAL。

## 切换 runbook（部署窗口）

1. 本仓镜像首推 TCR（GHA 首跑绿）→ staging 起双服务，四点冒烟（目录/卡片/A2A 真回合/
   结算+观测事件到账）。
2. DNS `wanxing.finddatatech.cloud` → 新 Ingress；fd-prod 双服务首上。
3. 切流验证：外部 key 真回合过 wanxing 域；`platform.finddatatech.cloud/api/wanxing/*`
   保留（兼容期），双跑观察。
4. paas 侧摘除 change（routes 摘挂 + spec 标 moved + 域名 301）——单独评审。
