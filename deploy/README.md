# fd-wanxing 部署 runbook（切片② L1/L2 切换）

> 代码与镜像已就绪；以下是部署窗口的动作清单。清单本体在 `deploy/*.yaml`。

## 前置（一次性）

1. **GHA secrets**：org secrets `TCR_USERNAME`/`TCR_PASSWORD` 对本仓启用（FindDataTechnology org
   settings → Actions secrets）。首推 main 触发 `images.yml`，双镜像落
   `ccr.ccs.tencentyun.com/yizuo/{wanxing-facade,fleet-observer}:main`。
2. **集群 Secret `wanxing-fleet`**（fd-prod namespace，键名全下划线、显式 secretKeyRef
   ——envFrom 破折号坑前科）：
   `ingest_token` / `registry_url` / `registry_token` / `backend_token` /
   `sub2api_base_url` / `sub2api_admin_key` / `packs_internal_base_url`
   （值从 paas fd-prod 现行 env 平移：`AGENT_SERVING_*` 家族 + `SUB2API_*` +
   `PACKS_INTERNAL_BASE_URL`）。
3. **DNS**：`wanxing.finddatatech.cloud` → fd-prod Ingress 入口（与 platform 同源不同 host）。

## 顺序

1. GitOps（gitee 真源）落 `deploy/fleet-observer.yaml`（tag=首推 sha）→ observer 首上，
   `/healthz` 绿；runner 侧 env 加 `AGENT_RUNNER_FLEET_URL`（指向 observer 集群内可达地址）
   + `AGENT_RUNNER_FLEET_TOKEN`，滚动 runner → 观测 `state_changed`/`runner_stats` 到账。
2. GitOps 落 `deploy/wanxing-facade.yaml` → facade 首上，`/healthz` 绿。
3. **四点冒烟**（wanxing 域）：公开目录 / AgentCard / A2A 真回合（外部 key）/ 结算 +
   观测事件到账（`/api/fleet/v1/board` 摄取滞后 < 1min）。
4. 兼容期双跑：`platform.finddatatech.cloud/api/wanxing/*`（paas 挂载版）保留，观察 ≥ 数日。
5. **paas 摘除 change**（另立）：gateway 摘 `registerWanxingRoutes` 挂载 + spec 标 moved +
   旧域 301 → wanxing 域。

## 回滚

- facade：GitOps revert 到上一 tag（数据根 wanxing.db 不回滚——账本只前进）。
- 整面退回 paas 挂载版：DNS/GitOps 撤 wanxing 域，paas 侧本来就没动。
