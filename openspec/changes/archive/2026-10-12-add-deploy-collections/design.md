# Design — add-deploy-collections（M4③ 集合）

## Context

M4③：一个数据模型承载三段式语义——a 组织分组（private 集合=自己的归类）、b 可部署套装
（public 集合+分享链接+一键全部署）、c 团队语义（**本片不建面**，mission/planner 是唯一协作
通道，集合只保持「可被引用的清单」形状）。硬约束落进 spec 文字。

## Goals / Non-Goals

- Goals: collections 表+CRUD+整表 entries 写；套装部署（逐条走部署核+逐条诚实结果）；
  公开分享面；web 两视图（#/collections 管理 + #/bundle/:id 分享）。
- Non-Goals: 不建集合执行语义（调度/运行/监控一概没有）；不做逐条增删 API（整表替换够
  v1，UI 草稿式编辑）；不做集合策展/热度（那是谦面的事）；不做 c 团队面。

## Decisions

### D1 — entries 为 JSON 列（一张表）

集合小（≤20 条）、无逐条查询需求、整表读写——JSON 列免去 join 表与位置列。校验在
facade 廉价形状门（数组/上限/去重/suggestedConfig 三键白名单），facet 部署时仍是权威。

### D2 — 部署核抽取：deployPackCore(who, packId, body)

selfservice deploy 路由的内联逻辑（wizard 键形状门→detail→ownership/greenfield→version→
payload 组装→转发→slug 映射）抽为闭包内函数；路由与套装部署共用。返回
`{status, body}`（body 已是响应形状）——套装端点把每条结果归一为
`{packId, agentId, verdict, slug?, error?}`。

### D3 — 套装部署的跳过语义

在役=**skipped** 不 refused：绿地规则是「不接管」，套装语境下重复部署已上线的条目是
幂等无害的常见场景（套装里混入已部署 pack），跳过+可见比拒收更诚实。错误/refused 才
阻断语义（但仍继续后续条目）。

### D4 — detail 解析复用 M4② 缓存

browse 60s 缓存（pack 名/版本/策展）+ directoryAgents 60s 缓存（agent 名）+ 部署快照
（在役）。公开面与 console detail 共用同一 resolve 函数；公开面剥 owner email。

### D5 — 分享边界拍板（挂账转正）

suggestedConfig 透传=套装的价值主张（「策展的配置」）；它是**部署时建议**不是执行语义
（部署者可改、facet 校验、部署后归 service-config 面）——不违反硬约束。仅引用清单=
不填 suggestedConfig 的退化子集，两种用法同一模型。

### D6 — web 路由与入口

App.jsx hash 正则加 `collections|bundle` 两段；VIEWS 表加两视图。ConsoleView 顶部加
「我的集合 →」链接（不加面板——IA 重构在 M4④，先不再喂胖 1039 行的视图）。bundle 页
匿名只读+登录引导；登录后复用部署对话组件（两视图共享一个 BundleDeployDialog）。

### D7 — 公开面限流

GET /collections/:id 无凭据——挂 facade 全局 RPM 面（与 catalog 同层），无独立限流
（列表不可枚举：id 随机、无列表端点）。

## Risks / Trade-offs

- **套装部署部分成功**：N 条中 k 条失败——响应逐条 verdict + deployedSlugs 汇总；不回滚
  已成功者（部署是幂等 upsert，重跑即收敛）。文案明确「部分成功」。
- **foreign 套装部署信任面**：public 集合任何验证身份可部署=与 M4② 绿地规则一致（计费
  键是部署者自己的）；在役条目跳过守住院「不接管」。
- **entries 引用悬空**（pack 下架/删除）：detail 解析时 name 缺失=诚实显示「已不可用」；
  部署时 facet 404 → 该条 error。

## Migration Plan

无 schema 迁移风险（新表 CREATE IF NOT EXISTS）；部署=facade+web 双滚。

## Open Questions

无。
