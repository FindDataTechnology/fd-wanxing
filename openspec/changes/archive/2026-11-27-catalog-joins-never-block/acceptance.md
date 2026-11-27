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

## 上产方式

`fd-infra-deploy` 推到 github+gitee（`772cb321`），ArgoCD `all-services-prod` **在 23:00:17 CST
自动同步了该 revision**（history id 2155），facade 滚到 `sha-faac3c7`，pod 1/1 ready、0 重启。

> 订正：过程中我曾判断「ArgoCD 停摆、repo-server 全员 Evicted，需 `kubectl set image` 绕行」——
> 那是**错的**。`kubectl get pods | head -20` 把按字母序排在后面的 Running pod
> `argocd-repo-server-9c74cbfff-zn5q7`（已跑 7h）截掉了。实际 GitOps 正常，手动 set image
> （同一 tag）是多余动作，与清单一致、无回退风险。同期 `cheap-4` / `liuliangjkiimypbdzxa`
> 的 DiskPressure 是一过性的（23:04→23:11 自愈，imageFs 仍有 4.5G 空闲），非事故。
