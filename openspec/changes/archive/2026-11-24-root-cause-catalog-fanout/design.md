# Design

> 动机与实测数据见 proposal.md。本文件只答「怎么做」与「为什么这样做而不是别的」。

## Context

三份棘手的现状事实，全部在 fd-prod 门面 pod 内实测（2026-11-23）：

```
registry = cheap-1 compose 的 MCP Gateway Registry fd-1.4.0（45 条 agent）

  GET /api/agents/{path}           单条读 ≈ 110ms
  27 条串行                        3485ms
  27 条并发                        2911ms     ← registry 侧也不能靠并发救
  GET /api/agents?limit=500        一页 45 条，含完整 metadata，198ms
```

列表与单条的字段差异（45 条逐条比对）：

| 字段 | 列表 | 单条 |
|---|---|---|
| `metadata` | 完整 | 完整，**45/45 逐字节相等** |
| `visibility` / `allowed_groups` / `is_enabled` / `supported_protocol` | 有 | 有 |
| `version` | **缺** | `"1"`…`"11"` |
| `capabilities` | **缺**（只有布尔 `streaming`） | `{}` 或 `{"streaming":true}` |
| `provider` | **拍平**为 `provider_organization` + `provider_url` | `{organization, url}` |
| `skills` | 名字数组 | 带 `description` 的对象数组 |
| `examples` | **缺** | 45/45 均未声明 |

`version` 的真相：registry 条目的 `version` 与 `metadata.packVersion` 在 45 条里有 **24 条不一致**（几乎都是 `"1"` vs 真实包版本）；而部署台账的 `dep.version` 与 `metadata.packVersion` 在 **34/34 个在役部署上完全一致**，且 4 个台账里有、registry 里没有的路径单条读也是 404 —— 台账与 registry 对「谁在役」的判断一致。

## Goals / Non-Goals

**Goals**

- 一次目录请求的 registry 上游读次数：与部署数无关，恒为「快照新鲜时 0，过期时 1 次列表读」。
- 并发读共享一次刷新；并发数增长不再线性放大耗时。
- 三个消费面（目录 / 公开状态 / 控制台列表）共用同一份快照，不再各持一套循环。
- 对外响应形状不变；唯一可见差异是 `version` 取值改正。

**Non-Goals**

- 不改 registry（跨仓）；不在门面之外加缓存层；不引入 Redis 或任何新依赖（`better-sqlite3` + `express` 之外不加新包）。
- 不改变准入、结算、七事实状态词汇、`sort=activity` 排序。
- 不做后台定时刷新（见 Decision 4）。

## Decisions

### 1. 用 registry 的列表读面建快照，而不是给 27 次单条读加 single-flight

只加 single-flight 能把「20 并发 = 20×27 次读」降到「27 次读」，但冷态仍是 2.9–3.5s，且每次 TTL 过期都要重新付这 3 秒。列表读面一次 198ms 拿到全部 45 条，两者差一个数量级。

**代价**：列表缺四个字段，必须合成（Decision 2）。这是有界的代价——四个字段的来源都实测可核实，且 `metadata` 完整这件事让 `paused`、`packVersion`、`connector_bindings`、`mcpTools` 这些真正被业务读的字段零改动。

**被否的替代**：给 registry 加服务端缓存 —— 那是另一个仓的另一个决定，且门面快照已经把上游读降到每 60 秒一次，收益重叠。

### 2. 四个合成字段，逐个取最近的真源

| 字段 | 取法 | 为什么不取别的 |
|---|---|---|
| `version` | 部署台账 `dep.version`；不在台账则 `metadata.packVersion` | 台账与 `packVersion` 34/34 一致；registry 的 `version` 有 24/45 陈旧 |
| `capabilities` | `streaming ? {streaming:true} : {}` | 45 条单条值只有这两种，0 处例外 |
| `provider` | `{organization: provider_organization, url: provider_url}` | 单条是这两个键的拼装；脱敏规则（`isPrivateProviderUrl`）照旧施加在合成后的对象上 |
| `examples` | 不提供 | 45/45 均未声明；目录与卡片面本来就「未声明即缺席」 |

三个「有、但降级」的字段：

- `skills`：快照里的名字数组**够目录卡用**（卡片只渲染名字），不够详情页（要 `description`）—— 详情改读卡片面（Decision 3）。
- `version` 在目录卡与详情页都显示，所以两处都跟着变。
- `provider` 只在卡片面用，脱敏规则必须保留（`redact-agent-card-private-endpoints` 是既有 spec，不能因合成而绕过）。

### 3. 详情页改读卡片面

详情页今天为了找一个 agent 拉整个目录（`page_size=200`），然后从列表行取 `skills`。既然列表行的 `skills` 没有描述，而卡片面（`/.well-known/agent-card.json`）1 次读就给全（版本、带描述的 skills、examples、脱敏后的 provider），详情页改读卡片面：

- 请求数从「1 次 200 条目录读」降到「1 次卡片读」，且 payload 从 15KB 降到 ~1KB。
- 详情页的版本与卡片面天然一致（消除「详情说 v1、卡片说 v4」这类分裂）。
- 目录卡仍然只吃列表行，不额外发请求。

**被否的替代**：让 registry 的列表也返回完整 `skills` 对象 —— 那是跨仓改动，且会让 45 条列表 payload 变大。

### 4. 快照按需刷新，不做后台定时器

`ensureFresh()` 已是既有入口（bookkeeping 快照同款）：请求到来时若过期则阻塞刷新；并发靠 single-flight 合并。不加 `setInterval`。

**理由**：门面是单副本（`replicas: 1`）；空闲时不该产生上游流量。已有的 stale-on-hiccup + 5 分钟硬过期窗口，让「没人访问」本身不需要刷新。

**代价**：TTL 过期后的第一个访客要等一次 198ms 的列表读。可接受，且比今天的 3.5s 好一个数量级。

### 5. 写路径保留单条读

暂停/恢复是「读完整 entry → 改 `metadata.paused` → PUT 回去」（`pausedEntryFor`，由 `contracts/lifecycle-write.fixture.json` 钉住）。它**必须**读完整条目，否则 PUT 回去会丢掉列表没携带的字段（`capabilities`、`examples`、完整 `skills`）。所以 `setPaused` 保留单条读，**快照只服务读路径**。

这是本设计里最容易做错的一处：把写路径也改成查快照，会把条目字段写丢。

### 6. `clusterUnits()` 并进快照 TTL

今天 `clusterUnits()` 每请求现算 `clusterMap()` + `listDeployments()`，而两者本身有缓存——所以它是「复用缓存但仍然做一遍 map 推导」。给它一个与条目快照同 TTL 的缓存即可，不需要新结构。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 列表读面某天开始悄悄不返回某字段（registry 升级） | 合成是**按字段列式**的，缺字段时字段缺席而非臆造；`test-public-contract.mjs` 的形状断言会在 CI 里判红 |
| 24 个 agent 的版本号从 `v1` 变成真值，某个消费者按 `v1` 写过判断 | 版本号变化在 proposal 与 tasks 里明写；回滚只需把 `version` 的来源改回 `entry.version`（单点） |
| 写路径误用快照导致 PUT 丢字段 | 设计里显式分离（Decision 5），tasks 里加一条「写路径仍打单条读」的断言 |
| registry 忽略 `offset` 导致分页死循环 | 跟随 `has_next` + 页数上限 + 重复页检测（borrowed-contracts 新 requirement 的第三个 scenario） |
| 快照变大型导致内存增长 | 45 条 × ~2KB ≈ 90KB；万级也只有 ~20MB，且是既有 per-slug 缓存本来就持有的同一批数据 |
| 首次请求冷启动 198ms | 与今天 3.5s 相比是改善；`/healthz` 深检已覆盖 registry 可达性 |

## Migration Plan

无数据迁移。门面是单副本 Deployment，滚动一次即生效；回滚 = 回退镜像 tag（既有回滚路径，见 `deploy/README.md`）。

上线后验收（真机）：
1. 同一分钟内 20 并发目录请求 → 全部 < 1s，且上游只收到一次列表读（看门面日志）。
2. 目录行与卡片面的 `version` 相等，且等于部署台账版本。
3. 落地页首屏 `/status` + `/agents` 两次请求的耗时不再随并发放大。
4. 暂停一个 agent → 目录在 60 秒内反映（不变）。

## Open Questions

- registry 为什么把 `version` 写成陈旧值（疑似注册 payload 里的 `version` 与 `metadata.packVersion` 来自两处、后者正确）。**不影响本设计**：门面已改为取台账版本，registry 侧的修复可另立专项。
