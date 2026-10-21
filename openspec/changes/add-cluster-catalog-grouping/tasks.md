# Tasks — add-cluster-catalog-grouping

## 1. facade：集群索引 + 目录标记

- [x] 1.1 routes.js：`listDeployments` 行附 `agentId`（additive）；a2a face 注入
  `packsDetailFetch(id)`（`packsInternalFetch('/api/packs/<id>')`）
- [x] 1.2 a2a.js：`clusterMap()`——browse 行 `agentCount > 1` → detail → 声明 `cluster` 才入索引
  `{name, description, defaultAgents, optionalAgents, members}`；60s 缓存 key 含 version；
  detail 失败降级上一份索引
- [x] 1.3 a2a.js：catalog 条目与 agent-card 带 `cluster: {id, name, role, members}`；
  `cluster=<packId>` 过滤（分页前、可与 q/category/featured 叠加）；`facets.clusters`；
  无声明 pack / 无参请求零变化
- [x] 1.4 测试（test-wanxing-facade.mjs）：标记形状与 role / 无声明多 agent 包保持扁平 /
  detail 失败降级 / version 变更失效 / `cluster=` 过滤前分页 / `facets.clusters` 基于未过滤集 /
  无参回归

## 2. facade：自助面透传声明

- [x] 2.1 selfservice.js：`clusterOf(detail)` 与 `deployableAgentsOf` 同源；my/packs 与
  catalog/packs 行带 `cluster: {name, description, defaultAgents, optionalAgents}`（声明时）
- [x] 2.2 测试（test-wanxing-selfservice.mjs）：声明透传 / 无声明无字段 / 声明不等于可部署

## 3. web

- [x] 3.1 CatalogView：精选/其余分区内按 `cluster.id` 归组——组头（名、`x / N 在本页`、默认/
  可选计数、收窄按钮 → `cluster=` 查询）、默认成员在前、无标记条目扁平不变；
  `data-testid="cluster-group-<id>"`
- [x] 3.2 DeployWizard：集群包只预勾 defaultAgents ∩ 可部署、可选成员标「可选」、列表上方显示
  集群名与描述；无声明包行为不变
- [x] 3.3 vite build 绿

## 4. 上线与实证

- [ ] 4.1 出片：facade + web 双镜像（公开快照线）→ relay → ccr digest → GitOps 两清单 → pod
  imageID 核验
- [ ] 4.2 数据前置（非代码）：集群包 v2 三成员补 `serving: {protocol: "a2a"}`（作者身份发布）；
  经 console 向导部署默认成员（部署者计费键）
- [ ] 4.3 生产实证：目录出现集群组头（`2 / 3 在本页` 或全员）、`cluster=` 过滤命中、
  `facets.clusters ≥ 1`、agent-card 带标记、向导对集群包默认只勾默认成员
