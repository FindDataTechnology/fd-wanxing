# Tasks — add-memory-visibility-console

## 1. facade 代理

- [ ] 1.1 routes.js：`memoryFetch` 装配（FD_MEMORY_URL/TOKEN，未配置退化 null）并传入 registerConsoleRoutes。验证：单测未配置 503。
- [ ] 1.2 console.js：GET /deployments/:slug/memory 与 POST …/memory/forget（ownerGate → rootKey=packId 派生 → 透明转发）。验证：单测 owner 200 透传 / 非 owner 403 零转发 / forget 无 confirm 400 透传。
- [ ] 1.3 `npm test` 全绿（既有 console 用例不回归）。

## 2. web 面板

- [ ] 2.1 FleetView：「记忆」按钮 + MemoryPanel（layer chips、客户端搜索、L2 展开、两步确认遗忘、403/503 分语横幅、UNCONFIGURED 隐藏按钮）。验证：走查脚本/手工 DOM 断言。

## 3. 出片与验收

- [ ] 3.1 fd-build-channel 判路 → wanxing 双镜像出片（facade+web）+ k8s 部署面 FD_MEMORY_* 两 env（secret fd-memory-platform）→ 滚产。验证：digest 双证 + ArgoCD Healthy。
- [ ] 3.2 生产验收：aloadtree 登录 console → 部署卡「记忆」→ L2 条目眼见（spider-heal 的 2 条带向量经验）→ forget 演练一次并确认审计行。验证：浏览器走查 + fd-memory 审计行。
- [ ] 3.3 台账 + 主 spec 同步（wanxing-facade/wanxing-web 各 1 ADDED）+ 归档 + 记忆更新。
