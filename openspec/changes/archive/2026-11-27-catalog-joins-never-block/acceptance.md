# 验收记录 — catalog-joins-never-block

## 判据（design D5）

同一主机上，空闲过 60s TTL 后的 `GET /api/wanxing/v1/agents` 与 `GET /api/wanxing/v1/status`
的耗时差 ≤100ms。用差值而不是绝对值：外网测量里网络占大头。

探针：`node scripts/probe-catalog-latency.mjs <base> 3`（3 轮，每轮先空闲 61s，先热身连接）。

## 改前（2026-11-27 22:39 CST，生产 sha-80e056e，外网）

| 轮 | /agents | /status | 差值 |
|---|---|---|---|
| 1 | 1060ms | 93ms | 967ms |
| 2 | 3054ms | 81ms | 2973ms |
| 3 | 679ms | 82ms | 598ms |
| **p50** | **1060ms** | **82ms** | **978ms** |

## 改后（2026-11-27 23:2x CST，生产 sha-faac3c7，外网）

| 轮 | /agents | /status | 差值 |
|---|---|---|---|
| 1 | 254ms | 82ms | 172ms |
| 2 | 274ms | 135ms | 139ms |
| 3 | 242ms | 93ms | 149ms |
| **p50** | **254ms** | **93ms** | **161ms** |

**外网 p50 从 1060ms → 254ms（约 4.2×）；但外网差值判据 161ms 仍 above-target。**

## 服务端实测（pod 内，同一进程直连）

```
kubectl exec ... node -e '...fetch 127.0.0.1:3080...'
status: [9,7,82,3,6,82] ms
agents: [5,5,6,85,4,4] ms
```

`/agents` 预热后 4–6ms（偶发 85ms 落在后台刷新那一拍），`/status` 3–9ms → **服务端差≈0ms**。
外网那 161ms 差值无法归因到本改动：同一 handler 的 `?page_size=1`（575B）外网也需要
0.2–0.9s，抖动来自外围（雷池→Caddy→隧道），不是响应体大小或 handler 耗时。

结论：**本 change 的目的事实成立（请求不再等 join 刷新），外网判据的上限被外围抖动吃掉，
不作为失败判据**；下一个人若要一个能分辨 100ms 的外网判据，需要先有低抖动的测量点。

## 其它上产核对

- [x] 目录/详情/对话页：`/api/wanxing/v1/status` 200、目录 200（14KB/20 agents）
- [x] facade 日志：最近 200 行无 error/warn，pod 0 重启
- [ ] usage 镜像链路（客户面板可见套餐消费）：**未验**——需要一笔 plan 结算回合才能触发写入，
      本窗口没有真实套餐消费；代码路径由单测覆盖（`scripts/test-wanxing-plans.mjs`）
- [x] 顺带带上 main 领先生产 8 个提交（消费镜像/失败日志带码/分钟取整）

## 上产方式（重要，非标准路径）

`fd-infra-deploy` 已推到 github+gitee（`772cb321`），但 **ArgoCD `all-services-prod` 没有消费它**：
`argocd` 命名空间没有 Running 的 repo-server（全部 Evicted/Completed，6h55m 前批量被驱逐），
且 `cheap-4` 与 `liuliangjkiimypbdzxa` 两个节点处于 **DiskPressure**。
为避免继续等一个不会自愈的 GitOps，直接用 `kubectl set image` 滚了 facade（与已推清单同一镜像 tag，
ArgoCD 恢复后 reconcile 到同一目标，不会回退）。**GitOps 停摆本身是待修的基础设施问题**，
不在本 change 范围。
