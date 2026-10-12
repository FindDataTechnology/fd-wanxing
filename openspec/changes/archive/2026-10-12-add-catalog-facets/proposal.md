## Why

M4②「挑得准」（`docs/facet-wanxing-roadmap.md` §M4）：目录是用户发现 agent 的第一面，今天只有
分页+当前页客户端搜索——服务端无筛选、无策展信号、无热度；console 部署向导的选包源只有
「我的 pack」，目录里发现的好货没有部署入口。谦面策展（category/featured，add-facet-content-
management 已在产）是双星合流的第一份可消费信号。

## What Changes

- **catalog 服务端 facets**（`GET /api/wanxing/v1/agents`）：新增查询参数 `q`（名称/描述/slug/
  标签大小写不敏感子串）、`category`（精确匹配）、`featured=1`、`facets=1`（响应带
  `facets: {total, featured, categories:[{name,count}]}` 汇总块）。过滤在分页**之前**发生。
  无参数=旧全量形状字节级不变（finddata 等既有调用方零迁移）。
- **策展信号消费（双星合流具体形态）**：catalog 条目带 `category` + `featured`——来源是 facet
  公开 browse（`/api/packs?pageSize=100`，60s 缓存，按 packId join 部署行）。featured 优先
  呈现、category 分组。
- **热度信号回流（挂账拍板）**：catalog 条目带 `turns7d`（本 facade usage 台账近 7 天外部回合
  数，含 api+chat 双车道）。**口径定案**：v1 = featured（策展优先档）+ turns7d（真实外部使用）
  双信号；安装数不采用（无安装事件回流，不可测）。
- **console「从目录部署」**：
  - 新端点 `GET /console/catalog/packs`：公开 listed pack（browse）join 每包 serving agent
  （detail，60s 缓存）join 在役状态（部署快照 packId 集）——`{packs:[{id,name,version,category,
  featured,deployableAgents,deployed}]}`。
  - 部署所有权放宽（**仅限绿地**）：foreign 公开 pack 且**当前无部署**时，console 已验证身份
  可部署——转发身份附加 creators 组（信任桥=console 允许清单⇒部署者资格；facet 侧门照常
  执法）。已在役的 foreign pack 拒收 400（升级归作者侧 my/packs 路径——杜绝接管他人在役
  部署）。自己的 pack 走原路径不变（含重部署/升级）。
  - 向导 step 1 加源切换「我的 pack / 目录可部署」；目录行带 category 徽标+featured 星标+
    在役徽标（在役禁选并提示）。
- **CatalogView**：搜索改服务端（q 参数防抖）；category chips（全部+n 计数）+精选前置分组+
  turns7d 活跃徽标。

## Impact

- 代码：`services/wanxing-facade/a2a.js`（facets+策展 join+turns7d）、`selfservice.js`
  （catalog/packs 端点+绿地部署）、`store.js`（per-slug 7d 回合聚合）、
  `wanxing-web/src/views/{CatalogView,ConsoleView}.jsx`。
- 依赖：无 paas 侧改动（策展经既有公开 browse；creators 组经转发身份）。
- specs：wanxing-facade catalog 需求增补 facets/策展/热度场景+selfservice 需求增补绿地部署；
  wanxing-web 目录页需求增补。
- 伞文档：M4 目录热度口径挂账随本片拍板并入已定决策表。
