# Design

## Context

公开目录的列表在 `services/wanxing-facade/a2a.js` 的 `GET /api/wanxing/v1/agents` 里组装：
先按部署顺序 `out.push(...)` 累积，再依次施加 `category` / `featured` / `cluster` 过滤与文本检索，
最后 `list.slice((page-1)*pageSize, page*pageSize)`。**顺序在这个函数里完全没被表达过**——它就是
`listDeployments()` 的返回序。首屏（`IntroView.jsx`）与目录页（`CatalogView.jsx`）各自 `fetch` 同一个
端点，前者带 `page_size=6`，后者带 `facets=1&page_size=12`。

每个条目已经带齐排序需要的全部信号：`featured`（策展）、`status`（`statusFor()` 派生的
`serving|idle|paused|unknown`）、`turns7d`、`name`。**没有新数据要取**。

## Goals / Non-Goals

**Goals:**
- 排序是一等公民：一个具名参数、一条纯函数规则、一条可单测的断言。
- 缺省行为逐字节不变（外部消费者零影响）。
- 首屏与目录页拿同一份顺序，页面不自造第二套判断。

**Non-Goals:**
- 不引入「推荐算法」。规则必须是可复述的一句话，`turns7d` 只是它在组内的次级键。
- 不缓存排序结果；目录端点本来就在 60s 缓存节奏上。
- 不改 `facets` 的统计口径（仍是未过滤全量）。

## Decisions

**D1 · 排序放服务端，做成 `sort` 参数而非改缺省。**
分页在服务端（`page_size` 上限 200），客户端排序只能排当页，改不了「谁进第一页」——而问题正是
第一页。做成参数而非缺省，是因为缺省调用方是四个外部消费者，「第一页内容变了」对他们是可观察的
行为变化，必须由调用方显式选择。
*备选*：新增一个 `/agents?order=activity` 端点的别名——被否，两条读路径 = 两份要同步的真源。

**D2 · 规则的完整全序，不留并列。**
`featured desc → status rank → turns7d desc → name asc`。加最后一级 `name` 是为了**决定性**：
没有它，同组同回合的条目顺序依赖 `listDeployments()` 的返回序，而那是快照，每次刷新可能不同——
同一份数据两次刷新出现不同首屏，比排序不对更糟。
*备选*：同一律、不排序——被否，目录 74% 条目零回合，等于首屏恒为 registry 序。

**D3 · 已暂停排最后，但它仍在列表里。**
`paused` 是管理员动作的结果，不是内容质量信号。它不该被当成「最不活跃」混在 `idle` 里，也不该
被过滤掉——过滤是 `status` 徽标与 chatability 门的事，排序只管先后。
*备选*：暂停条目完全排除——被否，那会让目录列表与 `total` 与部署现实的对应关系变模糊，
且与既有「所有已部署公开 agent 都列出」的 requirement 冲突。

**D4 · 首屏与目录用同一个参数，不各自实现。**
两处都只是 `&sort=activity`。页面侧零逻辑，页面就永远不能与 facade 的顺序吵架——与
`status-facts.js` 的单源纪律同构。

**D5 · 前端对未知参数优雅降级。**
旧部署会忽略 `sort`；那时的响应就是 registry 序。页面 MUST NOT 因为「排序没生效」报错或空白——
它拿到什么就渲染什么。这是既有的「live dependency 有界」约束的直接推论，所以只写进 spec 场景，
不加运行时代码。

**D6 · 集合入口放在导航，不放在「更多」里。**
`#/collections` 的登录门是它自己能说清的事（未登录显示登录提示）。把它藏进登录态分支会让
「这个功能存在吗」取决于访客恰好登没登录——那不是发现性，那是运气。

## Risks / Trade-offs

- **首屏可能长期不变** → 缓解：因为规则含 `turns7d`，它天然随使用变化；`name` 只做并列破局，
  不主导顺序。若将来出现「永远是同样六张」，那是策展（`featured`）该管的事，不是排序。
- **新部署永远上不了首屏** → 这是 `idle` 排第三的直接后果，且是**刻意的**：一个零回合的 agent
  不该在首屏占一个位置。它仍出现在目录第二屏与集合/向导里。若运营想推新部署，用 `featured`。
- **`name` 排序的本地化** → `localeCompare` 依赖运行环境的 ICU；Node 全量 ICU 下中文按拼音，容器
  镜像若为 small-icu 会退化成码点序。影响面仅为**同组同回合**的并列条目，不改变分组。记录在案，
  不在本刀引入 ICU 依赖。
- **外部消费者的第一页会变（仅当它们主动加参数）** → 它们不加就完全不变。这是 D1 的全部意义。

## Migration Plan

无数据迁移、无 schema 变更、无 env 变更。上线即生效；回滚 = 前端去掉 `&sort=activity`
（facade 侧参数留着无害，缺省路径一字节未动）。
