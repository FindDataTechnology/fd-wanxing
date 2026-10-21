# Design — add-cluster-catalog-grouping

## Context

facade 的目录（`GET /api/wanxing/v1/agents`）= 部署快照行（`{packId, agentId, agentPath,
deployedBy}`，slug = `slugFor(agentPath)` = `packs-<packid>-<agentid>`）join registry 条目
（名/描述/可见性/skills/examples）join 策展 map（facet browse 按 packId，60s）。browse 行自
壹座 sha-839f39c 起带 `agentCount`；detail 返回全 manifest（含 `cluster` 与 `agents[]`）。
两者都经 `packsInternalFetch`（`PACKS_INTERNAL_BASE_URL` + registry token）——借用契约不变。

## Decisions

**D1 分组信号 = 显式 `cluster` 声明，不是 `agentCount > 1`。** 多 agent 而无声明的 pack 是「一
袋角色」（向导验收 · 双子就是部署向导的测试包），作者声明才表示「这些角色是一个小队」。与壹座
`agent-catalog` 的规则逐字一致（「Entries from packs without cluster metadata … SHALL NOT carry
these fields」），两个平面对同一 pack 给同一答案。

**D2 索引数据源 = 既有公开 detail，只对 `agentCount > 1` 的 pack 拉。** 53 个在架 pack 里只有 2
个多 agent，detail 调用是常数级；缓存 60s（与策展同 cadence）且 **key 含 version**——republish
改了声明，下一轮刷新即见。失败降级到上一份索引（与 curationMap 同语义），目录永不因集群 join
阻塞。不在 paas 侧给 browse 行塞 `cluster` 块：那要滚壹座+谦面镜像，而 detail 已够用。

**D3 role 在 facade 算，不在 paas 算。** 部署行已有 `agentId`，`listDeployments` 只是没把它映射
出来（additive 补上）。`role = defaultAgents.includes(agentId) ? "default" : "optional"`。

**D4 分页与分组：不改分页算法。** 部署行序本就 `ORDER BY pack_id, agent_id`，同集群成员天然相邻、
通常同页；跨页边界时组头如实标 `x / N 在本页`。把「组不可拆」做进分页器会让 `total`/
`page_size` 语义变形——目录读者更需要诚实的部分组，而不是一个看似完整的假组。

**D5 `members` = 声明成员数，不是在役数。** 目录读者看到的是「这个小队应有几人」；在役几人由本页
条目数隐含（跨页标注补齐）。在役口径（`served`）属于集群单位，留给姊妹 change。

**D6 `cluster=` 过滤与 `facets.clusters` 走 category 的同一管线**：过滤前分页、汇总基于未过滤
集。无参请求形状不变（与 category/turns7d 增补时同一纪律：additive 字段，JSON 消费者忽略）。

**D7 向导预勾 = `defaultAgents` ∩ 可部署。** 可选成员保留可勾（部署者可以把投委会一起上）；
无声明 pack 保持「全部预勾」。声明只是向导提示，可部署性仍由 `serving` 定——集群包成员今天
没有 `serving`，向导会如实显示「有集群声明、0 个可部署」。

## Risks

- 集群包 v2 补 `serving` 后成员经 runner 组装 pack 资产（skills + mcpServers）；柏讯 MCP 工具
  是否在 runner 侧可达（凭据/网关剥头）属部署前置，不在本 change 代码内——真机验收时实测，
  失败即在台账如实记「目录分组可见但成员不可对话」。
- browse 100 条上限（既有 log 已告警）：集群索引只扫 browse 已返回的行，上限外的 pack 不分组
  ——与策展 join 同一已知边界。
