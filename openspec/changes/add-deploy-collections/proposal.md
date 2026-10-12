## Why

M4③「集合」（`docs/facet-wanxing-roadmap.md` §M4）：用户管理 agents 的集合——a 组织分组
（自己部署的归类）、b 可部署套装（多 pack 一键全部署/分享他人一键部署）、c 团队语义（远期，
mission 派发对象，本片只留门不建面）。**硬约束：集合永远不长执行语义，团队协作只经
mission/planner——违反即两套引擎。** 集合=引用清单，pack 仍是唯一原子供给单位。

## What Changes

- **数据模型（一张表）**：`collection = {id, owner, name, description, visibility(private|
  public), entries:[{packId, agentId?, suggestedConfig?}], timestamps}`——entries 为 JSON 列
  （≤20 条、无重复 packId+agentId）；引用不复制内容。
- **套装分享边界（挂账拍板）**：**含 suggestedConfig 透传**——entry 可带
  `{model?, budgetMinutes?, rhythm?}` 三旋钮（向导同款），套装部署时直传 deploy 载荷、
  部署者可改后提交；facet 仍是唯一校验权威。仅引用清单是其退化子集（不填即是）。
- **facade console API**（验证身份门）：CRUD（GET/POST/PUT/DELETE `/console/collections`）
  + 整表替换 entries（PUT `/entries`——UI 草稿编辑一次保存）+ detail 视图 join（browse
  缓存出 pack 名/版本/策展/在役 + directoryAgents 缓存出 agent 名）。
- **套装部署** `POST /console/collections/:id/deploy`（billingKey 必填+notifyChannel 可选）：
  顺序迭代 entries，逐条走 selfservice 部署核（own pack 原路径 / foreign 公开绿地路径，
  agentId 即子集）；**逐条诚实结果**：`deployed | skipped-in-service | refused | error`
  （在役=跳过不阻断后续；错误透传 facet 结构化文案）。owner 或 public 集合可部署（foreign
  private 404）。
- **公开分享面**：`GET /collections/:id`（无凭据）——仅 public（否则 404），条目解析同
  detail，不含 owner email。
- **web**：新视图 `#/collections`（集合管理：列表/建/编辑/条目编辑器（我的 pack+目录源）/
  分享链接/一键部署对话）+ `#/bundle/:id`（公开套装页：浏览者登录后可一键部署）；
  ConsoleView 加「我的集合」入口链接（不再加面板——IA 留给 M4④ 重构）。

## Impact

- 代码：`store.js`（collections 表+方法）、`selfservice.js`（部署核抽取 deployPackCore +
  collections CRUD/部署/公开面）、`wanxing-web/src/App.jsx`（两路由）+ 新 `CollectionsView.jsx`
  + `BundleView.jsx`。
- 依赖：零 paas 改动；绿地/在役语义复用 M4② 已上线路径。
- specs：wanxing-facade 新增集合需求（CRUD/套装部署/公开面）；wanxing-web 新增集合管理+
  套装页需求。
- 伞文档：M4 套装分享边界挂账随本片拍板并入已定决策表。
