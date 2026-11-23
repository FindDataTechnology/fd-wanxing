# fd-wanxing 部署说明 — GitOps 真源：fd-infra-deploy

> 部署文件不在本仓（用户定案 2026-10-04）：**live 清单在 `fd-infra-deploy`
> （gitee）`all-services/prod/wanxing-{observer,facade,web}.yaml`**，由既有 ArgoCD app
> `all-services-prod` 监视自动同步——无需新建 Application。本目录只留接线说明。

## 布局速查

| 组件 | 清单 | 暴露 |
|---|---|---|
| fleet-observer | wanxing-observer.yaml | NodePort **31881**（runner 直投 /ingest，tailscale 可达） |
| wanxing-facade | wanxing-facade.yaml | ClusterIP（仅 web 的 nginx 反代后面） |
| wanxing-web | wanxing-web.yaml | NodePort **31880** ← 边缘节点 SafeLine→Caddy→tailscale（wanxing.finddatatech.cloud，与 paas-admin 同法） |

滚动 = 在 fd-infra-deploy 改对应 yaml 的镜像 sha- tag 并推送；数据根 PVC 只前进不回滚。

## 一次性前置（镜像与凭据）

1. **GitHub 仓 secrets** `TCR_USERNAME`/`TCR_PASSWORD`（org secrets 对私有仓不可用，逐仓设）→
   Run workflow：三镜像落 `hkccr.ccs.tencentyun.com/yizuo/{wanxing-facade,fleet-observer,wanxing-web}`。
2. **relay 节点** `/etc/tcr-relay/repos.conf` 加三行同名 repo（relay 只认清单，≤5min 回灌 ccr）。
3. **fd-prod 集群 Secret**（fd-prod ns，键全下划线）：
   `kubectl -n fd-prod create secret generic wanxing-fleet --from-literal=ingest_token=… \
   --from-literal=registry_url=… --from-literal=registry_token=… --from-literal=backend_token=… \
   --from-literal=sub2api_base_url=… --from-literal=sub2api_admin_key=… \
   --from-literal=packs_internal_base_url=…`（值从 paas fd-prod 现行 env 平移）
4. **回填镜像 tag**：三份 yaml 的 `sha-TBD` → 首推 sha（ccr 侧等 relay 回灌后）→ push fd-infra-deploy。
5. **Caddy（边缘节点）+ DNS**：`wanxing.finddatatech.cloud` → NodePort 31880（照 paas-admin 条目抄）。

## 上线顺序与回滚

1. push fd-infra-deploy → ArgoCD auto-sync 滚起 observer → facade → web（同一 app 一次同步）。
2. runner（paas 侧滚动）env 加 `AGENT_RUNNER_FLEET_URL=http://<node-tailscale-ip>:31881` +
   `AGENT_RUNNER_FLEET_TOKEN`；ops-console 侧加 `FLEET_BOARD_URL/TOKEN`。
3. 四点冒烟（wanxing 域）：目录 / AgentCard / A2A 真回合 / 结算+观测事件到账。
4. 兼容期双跑 `platform.finddatatech.cloud/api/wanxing/*`（paas 挂载版）→ 观察数日 →
   paas 摘除 change（gateway 摘挂 + spec 标 moved + 旧域 301）。

回滚：fd-infra-deploy revert 镜像 tag 提交；整面退回 = 删三份 yaml 的 commit + Caddy/DNS 撤条目。
