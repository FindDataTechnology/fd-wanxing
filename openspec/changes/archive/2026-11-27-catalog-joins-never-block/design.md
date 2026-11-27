# Design

## D1. 形状：与两份既有快照同形的 SWR

`entrySnapshot` 与 `bookkeeping` 已经建立了本仓的 SWR 形态：`{ at, 值 }` + `inflight`，`staleness` 判断后
「后台 `void refresh().catch()`，返回当前值」，只有 **cold**（`!ready`）才 await。本 change 把这一形态
复制到 join 层，不发明新机制：

```
get():  !loaded            -> await 首份（失败上抛）
        fresh              -> 直接返回
        expired            -> void 单飞刷新, 立即返回上一份
```

## D2. 纳入范围：五处，不是四处

目录请求的 `Promise.all` 里**还有一个会阻塞的读者**：`snapshotClusterUnits()`（`unitsCache`，同一
60s TTL，过期即 await `clusterUnits()`）。只改四个 join 而留下它，请求仍然要等——延迟收益归零。
因此本 change 的实际范围是：

| 读者 | 现状 | 改后 |
|---|---|---|
| `curationMap` | 过期阻塞 + 单飞 | 过期不阻塞 + 单飞 |
| `clusterMap` | 过期阻塞 + 单飞 | 过期不阻塞 + 单飞 |
| `connectorDeclarations` | 过期阻塞 + 单飞 | 过期不阻塞 + 单飞 |
| `turns7dMap` | 过期阻塞、**无单飞** | 过期不阻塞 + 单飞 |
| `snapshotClusterUnits` | 过期阻塞、无单飞 | 过期不阻塞 + 单飞 |

`turns7dMap` 与 `snapshotClusterUnits` 目前没有单飞，并发过期时每个请求各发一次上游读；补单飞是
场景「Concurrent readers share one refresh」的前置条件，不是顺手优化。

## D3. 抽不抽辅助

五个读者的差异只在「装载函数」和「值的形状」（四个 Map、一个 List）。抽一个 ~15 行的
`createSnapshotCache({ load, ttlMs })` 能把五份重复的 `at/inflight/if` 收敛成一处，且与
`bookkeeping.js` 的既有形态一致；`clusterMap` 多带一个 `details` 旁路缓存，作为「装载函数内部的实现
细节」留在原地。

决定：抽。五个几乎逐字相同的读者，不抽的话本 change 会制造五份需要同步维护的 SWR 逻辑。
`bookkeeping.js` 的版本语义更重（diff、hard-stale、poke），**不合并**，保持独立。

## D4. 新鲜度诚实

目录不承诺五个快照原子一致（今天也不承诺）。SWR 之后最坏情况是某个 join 比 entries 快照旧一次
刷新时长（秒级），仍在既有 60s 语义内。**不加** `status_as_of` 之类的新契约字段——响应形状不动。

## D5. 验收：前后对照，不看感觉

新增 `scripts/probe-catalog-latency.mjs <base>`（零依赖，node 直跑）：

1. 丢弃首请求（冷启动）。
2. 空闲等待 > TTL（61s），计时一次 `/api/wanxing/v1/agents`；重复 3 轮取 p50。
3. 同法计时 `/api/wanxing/v1/status` 作为基线。

判据：改后「过期后」的 `/agents` 耗时 SHOULD 与 `/status` 基线相差 ≤100ms（服务端 join 等待≈0）。
改前的对照值已在 proposal 里记录（0.51–1.14s vs 0.23–0.31s，外网口径）。上产后用同一探针复测，
结果写进 `acceptance.md`。

限制：探针从外部跑时包含网络抖动，所以判据用「与同主机 /status 的差值」而不是绝对值。

## D6. 风险与边界

- **过期窗口延长**：从「等上游」变成「多陈旧一次刷新时长」。既有语义已允许 60s 陈旧，这是可接受的
  增量；写操作（暂停/恢复）走 `invalidateEntries()`，只失效 entries，join 的陈旧不变。
- **首份失败**：cold 路径保持上抛，路由层仍是显式 503——不会用空目录冒充「没有 agent」。
- **并发风暴**：单飞是唯一防线，必须确认五个读者都接上（D2 表）。
- **不做的**：`clusterMap` 串行 detail 读并行化、TTL 调整、跨进程缓存。等 D5 实测剩余耗时再议。
