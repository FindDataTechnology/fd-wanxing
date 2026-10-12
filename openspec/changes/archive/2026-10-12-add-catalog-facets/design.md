# Design — add-catalog-facets（M4② 挑得准）

## Context

M4②：目录筛选+策展消费+从目录部署+热度回流。全部地基在产：facet browse 带 category/featured、
facade 部署快照带 packId、usage 台账带 agent_slug+started_at、facet 部署门认 creators 组。
**单仓 change（fd-wanxing），零 paas 改动。**

## Goals / Non-Goals

- Goals: catalog 服务端 facets（q/category/featured/facets 汇总）；策展 join+turns7d 回流；
  console catalog/packs 目录源；绿地 foreign 部署；CatalogView 服务端筛选+分组呈现。
- Non-Goals: 不动 facet（browse 已够）；不做安装数信号（无回流，挂账拍板不采用）；不做
  跨页聚合搜索索引（子串够用，目录体量 ~20）；不建 observer 新面（热度走自家台账）。

## Decisions

### D1 — facets 过滤在分页前、汇总不过滤

```js
let list = out;                                  // 全量 public 条目（带策展+turns7d）
const filtered = applyFilters(list, q/category/featured);
if (facets=1) block = summarize(list);           // 汇总基于未过滤集
return page(filtered) + { facets? } + total: filtered.length
```
无任何参数 → 旧形状（无 facets 键）。`q` 大小写不敏感子串匹配 name/description/slug/tags。

### D2 — 策展 join：一次 browse、60s 缓存、诚实降级

a2a face 新增 `curationCache`（Map packId→{category,featured}，TTL 60s 与 entryCache 同律）。
来源=`packsInternalFetch('/api/packs?pageSize=100')`（服务端到服务端，匿名视角=公开 listed 包
——私有 pack 本就不进目录）。join 缺失→条目不带 category（渲染归未分组），**绝不阻塞目录**
（spec 场景）。pageSize 上限 100——超过即截断并在日志计数（目录体量现实 ~20，注释里写明
诚实边界）。

### D3 — turns7d：自家台账 GROUP BY 一次

store 新增 `usageTurnsByAgent(sinceMs)`：`SELECT agent_slug, COUNT(*) FROM wanxing_usage
WHERE started_at >= ? GROUP BY agent_slug`。catalog 构建时一次查、按 slug 映射；无行=0。
口径=api+chat 双车道外部回合（subsidy/host 都算「有人用」）。

### D4 — 绿地 foreign 部署：门在 facade、信任桥=转发组

selfservice deploy 所有权分支：
```
own pack           → 原路径（groups 原样=[]，可重部署/升级）
foreign + public   → 查部署快照：该 packId 无在役行 → 放行，转发身份附加 groups:['creators']
foreign + 在役     → 400 「pack 已在役——升级走作者侧（my/packs）」
foreign + private  → 404（现状，不动）
```
facet 侧 isCreator/isAuthor 门照常执法（转发的 creators 组就是给它看的）。**在役判定用部署
快照的 packId 集**——与 my/packs 的 deployed 信号同源。trust-bridge 注释写明：console 允许
清单是运营者发放的部署者资格，facade 以此为据为转发身份作保。

### D5 — console catalog/packs：browse+detail join、60s 缓存、在役徽标

`GET /console/catalog/packs`（gate=验证身份）：browse（D2 缓存复用）→ 每包 detail 取
deployableAgents（**独立 60s 缓存**，复用 my/packs 的映射逻辑——抽 `deployableAgentsFor(detail)`
小函数两处共用）→ join 在役 packId 集。行形状 `{id,name,version,category,featured,
deployableAgents,deployed}`。detail 失败的包按 my/packs 同律=不可部署行（诚实列出）。

### D6 — CatalogView：chips+精选组+服务端搜索

- fetch 加 `&q=&category=&featured=&facets=1`（防抖 300ms）；
- chips 行= facets.categories（`全部(n)` 起）；精选 chip= `featured=1`；
- 列表先渲染 featured 命中组（「精选」标题），再渲染其余（或按 category 分组小标题——
  v1 不做组内再分组，chips 已承担筛选）；
- 卡片加 category 徽标+`近 7 天 N 回合`徽标（0 不渲染，降噪）。

### D7 — 向导目录源：源切换+在役禁选

DeployWizard step 1 顶部 tab：`我的 pack` | `目录可部署`。目录源 fetch console/catalog/packs
（进入 step 1 时拉一次）。行渲染 category 徽标+★featured+「在役」徽标；`deployed` 行
disabled+title 提示。选中绿地带入与 my packs 完全一致的 draft 初始化。

## Risks / Trade-offs

- **绿地窗口竞态**：两个部署者同时绿地部署同一 pack——facet 端 registry upsert 幂等，后到
  覆盖先到（与作者重部署同语义）；窗口极小，接受（记录在案）。
- **browse 100 上限**：诚实截断+日志计数；目录破百时改为分页循环（挂账到破百时）。
- **turns7d 含补贴回合**：口径选择「有人用」而非「有收入」——策展呈现用，非计费对账。

## Migration Plan

无 schema/配置变化。部署=facade+web 双滚（law-ai-official 线，配额坑注意用 pod image 验证）。

## Open Questions

无。
