## Why

`add-cluster-catalog-grouping` 让目录**看得见**集群；但调用方想用整个小队，仍要自己打 N 个成员
路由、自己聚合。壹座侧的集群任务扇出（cron-runner `runClusterTurn`）是 cell 内物，只服务 cell
主人，不对外。萬星的定位是「Agent 服务的对外运行与服务平台」——一个 served 集群理应是**一个
A2A 服务单位**：一条路由、一张卡、一次 `message/send` → 扇出到在役成员 → 按策略聚合回一条
答复；而每个成员回合**仍按既有准入 / 计量 / 结算内核逐个走账**，单位本身不另立计费。

## What Changes

- **集群单位身份**：声明 `cluster` 且 ≥1 个 `defaultAgents` 在役的 pack ⇒ 单位
  `slug = slugFor(packId)`，路由族 `/api/wanxing/v1/a2a/cluster/:clusterSlug`（与 per-agent 路由
  段数不同，路径形状天然互不匹配）。真相 = 集群索引 + 部署快照，facade **不持久化**集群定义。
- **公开发现**：`GET /api/wanxing/v1/clusters`（成员带 role / served / slug）；
  `/a2a/cluster/:slug/.well-known/agent-card.json`（skills = 在役公开成员；
  `capabilities.streaming: false`；扩展块 `cluster`：成员、角色、策略、支持的聚合）；
  A 的目录 `cluster` 标记在单位在列时补 `slug` + `url`。
- **回合**：仅 `message/send`（`message/stream` 答 -32601）。key 门同 per-agent 门；RPM **只计
  一次**；plan 门一次；(caller, 单位) 一个槽。成员集 = 在役默认成员，或 `metadata.agents` 指名
  的在役子集（未知 id → -32602 指名）。**逐成员准入**：paused / 私有未授权 / 成员槽被占 →
  该成员 `skipped` 带原因；≥1 成员准入才跑，否则结构化拒绝列明每个成员的原因、不跑任何回合。
- **扇出与聚合**：并发上限 = 声明 `schedulingPolicy.maxConcurrentRuns`（缺省 = 成员数，即真
  并行——成员是独立部署，无壹座共享运行时的串行约束）；成员超时
  `WANXING_CLUSTER_MEMBER_TIMEOUT_MS`（默认 300000）；成员上下文 = `<单位上下文>--<agentId>`。
  聚合 `metadata.aggregation` ∈ `all`（缺省：成功成员各一节带名，失败/跳过成员脚注）/ `first`
  （首个成功）/ `summary`（在声明序首个成功的默认成员上**多跑一回合**综合全部成功产出；综合
  失败回落 all 并注明）。响应 = 一条 A2A message + `metadata.cluster`（成员状态 / 原因 / 时长 /
  计费分钟 / summaryBy）；全员 error → JSON-RPC error `CLUSTER_ALL_FAILED` 仍带该块。
- **计量**：**每个成员回合都是真回合**——成员槽、usage 行（`agent_slug` = 成员、`idem_key` =
  `<key>--<agentId>` / `--summary`、新列 `cluster_turn_id` 关联同一次集群回合）、结果口径
  （成员 JSON-RPC error / 不可读 → error + waived）、plan 抽取、部署者分成、完成回调、fleet 事件
  **全走既有路径不改**。单位本身零 usage 行。复合幂等在 (caller, 单位) 上
  （`idempotentSend`），成员派生键让中途崩溃后的重放只重跑未完成成员。
- **web**：目录组头展示单位端点（可复制）+「集群调用」链接；docs 一页纸加「集群调用」节
  （路由、send-only、成员选择 / 聚合 metadata、逐成员计费、curl 样例）。

## Non-goals

- agent-runner 零改动；无 streaming；无跨 pack 集群；对话车道 / 嵌入车道不接集群单位；
  missions 不接集群；不做集群级定价（成员逐个计费，单位不加价）；不持久化集群定义。

## Impact

- 代码：facade 新模块 `cluster.js`（单位解析 / 扇出 / 聚合 / 卡片 / 列表）；`a2a.js` 把成员
  回合核心（转发 + 结果口径 + finish）抽成可复用的 `runMemberTurn`；`core.js`
  `recordUsage` 加 `clusterTurnId`；`store.js` 加 `cluster_turn_id` 列；`routes.js` 接线；
  web `CatalogView.jsx` 组头端点、`DocsView.jsx` 新节、`A2aSample.jsx` 集群变体。
- specs：wanxing-facade +4 ADDED、wanxing-web +2 ADDED。依赖 A 的集群索引（同仓先后落地；
  两 change 全 ADDED，归档顺序无约束）。
- 前置：同 A 的数据前置（集群包 v2 `serving` + 部署默认成员）。
