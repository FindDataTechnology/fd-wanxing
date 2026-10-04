# Tasks: add-facade-extraction

## 1. 代码迁入

- [x] 1.1 `services/wanxing-facade/`：六模块平移（core/a2a/store/bookkeeping/
      fleet-report/routes）+ `lib/sub2api-admin.js`；routes 版摘 allowlist 三路由与
      resolveUser 依赖（注释指⑤），ops usage 仅服务凭据；新 entry index.js
- [x] 1.2 测试平移：facade 套件（31，reap 用例属 runner 留 paas）+ bookkeeping 套件
      （7）改 import 入本仓 scripts/；全仓 `npm test` 44/44 绿（517 用例按契约桩改写：
      packs 内部 API 以最小 HTTP 桩替真面，allowlist 经 store 直种）

## 2. 规格与工件

- [x] 2.1 spec fork：paas wanxing-facade spec（含① delta 效果，7 requirements）入本仓
      specs/，头部注记迁出来处；本 change 的「独立部署单元」delta 入 change 目录
- [x] 2.2 program 文档：②状态更新 + 上报切换点修订（跨进程保留，理由：observer 有状态
      PVC/facade 可水平扩，at-least-once+确定性 id 已验）+ 切换 runbook 落档
      （deploy/README.md）

## 3. 镜像与发布线

- [x] 3.1 Dockerfile（SERVICE build-arg 双 entry，bookworm-slim 多阶段 + aliyun 源）
      + `.github/workflows/images.yml` 双镜像推 TCR——**文件就绪；GHA 首跑待 org
      secrets 对本仓启用**（deploy/README 前置 1）
- [x] 3.2 双 entry 起服冒烟（本机无 docker daemon，容器门=GHA 首跑）：facade
      /healthz ✓ + 无源目录 503 ✓；observer /healthz ✓ + ingest 幂等接收 ✓ +
      timeline 回读 ✓

## 4. 部署清单与切换（部署窗口）

- [x] 4.1 `deploy/`：facade+observer 的 Deployment/Service/PVC/Ingress
      （wanxing.finddatatech.cloud；凭据全显式 secretKeyRef）+ deploy/README.md runbook
- [ ] 4.2 staging 四点冒烟（目录/卡片/A2A 真回合/结算+观测事件到账）——待镜像首推+staging
- [ ] 4.3 DNS+GitOps 落子，fd-prod 双服务首上，切流复测；paas 摘除 change（另立）
