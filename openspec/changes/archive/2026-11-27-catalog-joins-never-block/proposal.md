# Proposal

## Why

目录热路径的扇出已经根治（`root-cause-catalog-fanout`，2026-11-24 归档），但剩下的延迟来源是
**缓存一过期就阻塞**：curation / cluster / declarations / turns 四个 join 都是 60 秒 TTL，到期后
请求原地 await 上游，而不是像两份快照那样先出上次结果、后台刷新。

生产是低频流量（近 7 天 39 回合）。这意味着**几乎每个访客访问目录都落在 TTL 过期之后**，替所有人
付一次冷启动。实测（2026-11-27，同一主机、同一台 Mac）：

| 路径 | ttfb |
|---|---|
| `/status`（快照 SWR） | 0.23–0.31s |
| `/agents`（四个 join 阻塞） | 0.51–1.14s |

上游代价是代码注释里已有的真机测量：packs browse **541ms**；16 并发过期瞬间 **6406ms**，而同期
`/status` 只有 79ms。扇出修完之后，阻塞成为目录延迟唯一的大头。

## What Changes

- `curationMap` / `clusterMap` / `connectorDeclarations` / `turns7dMap` / `snapshotClusterUnits`
  改为 stale-while-revalidate：TTL 过期时**立即返回上一份快照**，单飞刷新在后台跑；**冷启动仍阻塞
  一次**（不允许空目录）。第五个（集群单元列表）在同一个 `Promise.all` 里也会阻塞，漏掉它收益归零。
- 刷新失败保留上一份快照（现有降级语义不变）；硬窗口、503 语义、单飞语义都不动。
- 新增一条可重跑的目录计时探针（脚本），前后对照写进验收记录——不做「感觉快了」。
- 对外响应形状、缺省排序、60 秒 TTL、`/status` 全部不动。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-facade`: 新增要求「目录的 join 快照过期不阻塞请求」（ADDED requirement；既有 requirement
  文本不改，避免整块替换吞场景）。

## Impact

- `services/wanxing-facade/a2a.js` — 四个 join 的读取函数；可能抽一个与既有快照同形的极小 SWR 辅助。
- `scripts/` — 新增目录计时探针（零依赖，`node` 直跑）。
- 不涉及 `wanxing-web`、`contracts/`、对外契约修订号。

## Non-goals

- **不并行化** `clusterMap` 里「每个多 agent pack 一次串行 detail 读」——先让请求不等它，等 SWR 上线
  实测剩余耗时再决定值不值得动。
- 不改 TTL 数值（60s 是既有契约），不加跨进程/外部缓存，不改 registry/packs 借用面。
- 不做消耗页视角收敛（C 面另议）。
- 不改 `/status`、不改目录响应字段与排序语义。
