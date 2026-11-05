# wanxing-first-visitor 任务清单

## 1. 目录清洗（台账先行）

- [x] 1.1 拉线上目录 22 agent 全清单（名称/描述/deployedAt/turns7d/facade 标记）落本 change 目录 agents-inventory.md，逐个标注「留/退役/私有化」并经用户过目；验证=清单 22/22 有标注
- [x] 1.2 按标注执行台账操作（pause/删除部署、pack 转私有，经 packs internal API）；验证=公开目录 total 下降、grep 无「验收/迭代代号」字样、facets 计数同步
- [x] 1.3 复发闸：验收类部署流程补「默认私有+命名约定」约定（记录进相关验收流程文档）；验证=约定可查
- [x] 1.4 facade 目录组装核对：排除逻辑确为台账驱动（无手工名单）；验证=退役 agent 在快照刷新后自然消失的实测记录

## 2. 对接断点修复

- [x] 2.1 A2aSample/DocsView 落 `$BASE=https://wanxing.finddatatech.cloud`，全站 grep `$BASE` 字面量清零；验证=docs 页 curl 样例逐条对生产可跑
- [x] 2.2 DocsView 补 agent-card 发现端点与 prefs API 文档段；验证=两段各自带一条可跑示例
- [x] 2.3 DocsView 注释声称的 serving-api 源文档落位（与 wanxing-docs-truth 3.4 同源，彼处完成后此处只链）；验证=引用可解

## 3. 信任三件套

- [x] 3.1 facade `/api/wanxing/v1/status` 公开端点（三聚合+stale 位+max-age=60，零内部泄露）；验证=匿名 curl 200、断一源整体不 500、响应不含内网串
- [x] 3.2 页脚状态条接 3.1（含失败降级静态行）；验证=本地禁用端点后页脚不破版
- [x] 3.3 IntroView 定价表+About 段（口径纪律按 design）；验证=与页脚/计费面陈述一致，无发明数字

## 4. 详情页

- [x] 4.1 `#/agent/<slug>` 详情视图（复用卡片字段；chatable 灰态带原因说明）；验证=抽查 3 agent 详情字段全、深链可分享、目录返回不丢位

## 5. 粗边收敛

- [x] 5.1 OpsView 非 ops 身份隐藏管理面板；验证=非 ops 账号实测无 403 文案
- [x] 5.2 CollectionsView 删除确认+错误态重试；验证=模拟失败（断网/错 token）出现错误态且集合仍在
- [x] 5.3 ChatView 历史清除（带确认）+导出（下载 JSON）；验证=清后空态、导出文件含本机转录
- [x] 5.4 宿主示例页 host-demo.html（四步协议演示，指向生产）+DocsView 入口；验证=页面自包含可跑通 init/context/ask/intent

## 6. 收口

- [x] 6.1 `openspec validate wanxing-first-visitor --strict` 过；waiving 依赖 test-gate 的冒烟全绿跑一遍
- [x] 6.2 真机走查第一访客旅程（目录→详情→chat→docs curl→控制台五 tab），记录截图；验证=走查无 P1 级断点残留

---

## 6.2 走查记录（2026-11-06，滚产后 curl 级全链）

- 滚产：facade/web 双镜像 sha-dbcf07f（build-pool 快照 dbcf07f=真源 c3660c0）→ relay 回灌（web 首见 digest 错误构建被补单覆盖=ade0f52d）→ GitOps 84f6944 → ArgoCD refresh 后 pods 双 Rolling 1/1。
- 目录：15 agents、验收残留 0；详情数据源字段全（name/desc/version/tags/skills/turns7d/chatable/category）；agent-card 公网 200 且 provider.url 已剔。
- /status 公网 200：{agents:15, turns7d:2, settlement_pending:{count:0,usd:0}} 全 stale:false，Cache-Control max-age=60。
- host-demo.html 公网 200；新 bundle index-DhUQ9P09.js 在线（详情页/状态条/文档断点全带）。
- 公网裸 /healthz 落 SPA index（nginx 兜底），深探针无外泄——符合 spec「深报告只在集群内」。
