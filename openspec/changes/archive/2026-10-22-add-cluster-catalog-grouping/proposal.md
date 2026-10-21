## Why

萬星目录是人类发现 agent 的第一面。壹座侧 agent-cluster-platform（2026-10-22 归档）让谦面 pack
可声明 `cluster`（≤3 成员的小队模板：name/description/defaultAgents/optionalAgents/
schedulingPolicy），首个集群包「柏讯 · 投研三镜头」（`egaYyOaZVTf0FWlLvaGAQA` v1）已上架。但萬星
的部署单位是 **pack → N 个各持 slug 的独立 served agent**，目录把同一小队的成员当作互不相干的
扁平条目——集群身份在部署那一刻丢失。用户问「萬星有 agents 集群市场吗」，今天的诚实答案仍是
「没有」。

生产实情（2026-10-22 实测）：9 个在役 agent 来自 9 个单 agent pack；唯一在役的多 agent pack
（向导验收 · 双子，无 `cluster` 声明）只部署了一个成员；集群包三成员**尚无 `serving` 契约**
（不可部署）——所以目录至今从未有过可分组的东西，本 change 既补能力也定数据前置。

## What Changes

- **facade 集群索引**（a2a face，与策展 join 同一管线）：browse 行 `agentCount > 1` 的 pack
  取 detail（`/api/packs/:id`，60s 缓存、key 含 version 故 republish 即失效），读
  `manifest.cluster` + `agents[]`；**只对声明了 `cluster` 的 pack 建组**（与壹座目录规则一致：
  作者的声明才是「小队」信号；向导验收 · 双子保持扁平）。detail 失败降级到上次索引，目录永不
  因它阻塞。
- **catalog 条目与卡片带 `cluster` 标记**：`{id: packId, name, role: default|optional,
  members: 声明成员数}`；role 由部署行 `agentId` 对照 `defaultAgents` 算出（`listDeployments`
  附 `agentId`）。无声明 pack 的条目零变化。
- **`cluster=<packId>` 过滤**（分页前，与 `q/category/featured` 可叠加）+ `facets.clusters`
  （未过滤公开集中的集群数）。
- **自助面透传声明**：`GET /console/my/packs` 与 `GET /console/catalog/packs` 每包带
  `cluster: {name, description, defaultAgents, optionalAgents}`（声明时）；可部署性仍只看
  `agents[].serving`。
- **web**：CatalogView 在精选/其余分区内把带标记的条目按 `cluster.id` 归组——组头显示名、
  声明成员数、默认/可选计数，默认成员在前，组头可一键收窄到该集群；跨页截断如实标
  `x / N 在本页`。DeployWizard 对集群包只预勾 `defaultAgents`、可选成员标「可选」、列表上方
  显示集群名与描述。

## Non-goals

- 集群级端点 / 一次调用扇出聚合——姊妹 change `add-cluster-service-unit`。
- 部署语义不变：成员仍逐个部署、逐个计费、逐个 slug。
- console 舰队页按集群分组；跨 pack 集群（壹座的动态集群是 cell 本地物，不发布）。
- paas 侧零改动：browse 的 `agentCount`（json_array_length）与 detail 的 `cluster` 块均已在产。

## Impact

- 代码：`services/wanxing-facade/a2a.js`（clusterMap + 条目/卡片标记 + `cluster=` 过滤 +
  `facets.clusters`）、`selfservice.js`（声明透传）、`routes.js`（`listDeployments` 带
  `agentId`、detail 取数接线）、`wanxing-web/src/views/CatalogView.jsx`、
  `views/console/DeployWizard.jsx`。
- specs：wanxing-facade +3 ADDED、wanxing-web +2 ADDED——不改既有需求，与在途
  `add-copilot-control-surface`（同样 ADDED-only）零交叠，归档顺序无约束。
- 发布前置（数据，非代码）：集群包 v2 为三成员补 `serving: {protocol: "a2a"}` 并部署默认成员，
  目录才有可见分组——这是真机验收条件，不是本 change 的代码任务。
