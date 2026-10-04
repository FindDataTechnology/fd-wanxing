# fd-wanxing 部署 runbook（切片②③⑤）— ArgoCD 流

> 部署机制 = ArgoCD（用户定案 2026-10-04）：`argocd/application.yaml` 一次性注册后，
> ArgoCD 监视本仓 `deploy/` 自动同步。滚动服务 = 改 `deploy/*.yaml` 的 `IMAGE_TAG`
> 提交推送，其余交给 auto-sync。

## 前置（一次性，均为用户侧/一次性动作）

1. **GitHub 仓 secrets**：`TCR_USERNAME` / `TCR_PASSWORD`（org secrets 对私有仓不可用，
   必须逐仓设；值=平台组 TCR 推送凭据，hk 侧）。设好后 Run workflow 一次——三镜像
   （`yizuo/{wanxing-facade,fleet-observer,wanxing-web}`）落 hkccr。
2. **cheap-3 relay 清单**：`/etc/tcr-relay/repos.conf` 加三行
   `yizuo/wanxing-facade` / `yizuo/fleet-observer` / `yizuo/wanxing-web`
   （relay 只认清单，≤5min 回灌 ccr；集群引用 ccr 前缀）。
3. **ArgoCD 仓库凭据**：现有 HTTPS GitHub 凭据须覆盖 `FindDataTechnology/fd-wanxing`
   （私有仓）；不够就在 ArgoCD Settings → Repositories 加一次。
4. **集群 Secret**（namespace `wanxing`，键全下划线、显式 secretKeyRef）：
   `kubectl -n wanxing create secret generic wanxing-fleet --from-literal=ingest_token=…
   --from-literal=registry_url=… --from-literal=registry_token=…
   --from-literal=backend_token=… --from-literal=sub2api_base_url=…
   --from-literal=sub2api_admin_key=… --from-literal=packs_internal_base_url=…`
   （值从 paas fd-prod 现行 env 平移）。
5. **DNS**：`wanxing.finddatatech.cloud` → fd-prod Ingress 入口。

## 上线顺序

1. `kubectl apply -f argocd/application.yaml -n argocd`（或 ArgoCD UI 加同构 app）。
2. deploy 清单 `IMAGE_TAG` 从占位改为首推 sha- tag（等 relay 回灌 ccr 后）→ auto-sync
   滚起 observer → facade → web。
3. runner 侧（paas，另一次滚动）：env 加 `AGENT_RUNNER_FLEET_URL`（observer 集群内地址）
   + `AGENT_RUNNER_FLEET_TOKEN`；ops-console 侧加 `FLEET_BOARD_URL/TOKEN`。
4. **四点冒烟**（wanxing 域）：目录 / AgentCard / A2A 真回合（外部 key）/ 结算+观测
   事件到账（board 摄取滞后 < 1min）。
5. 兼容期双跑 `platform.finddatatech.cloud/api/wanxing/*`（paas 挂载版）→ 观察数日 →
   paas 摘除 change（另立：gateway 摘挂 + spec 标 moved + 旧域 301）。

## 回滚

- 单服务：`IMAGE_TAG` 改回上一 sha- 提交（auto-sync 滚回；数据根只前进不回滚）。
- 整面退回 paas 挂载版：ArgoCD app suspend + DNS 撤 wanxing 域。
