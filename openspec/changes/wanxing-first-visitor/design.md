# wanxing-first-visitor 设计

## 验收 agent 退役机制

裁决=退役/私有化，且 spec 要求「exclusion rides the ledger state——facade 不加手工黑名单」。执行路径：

1. **优先走台账**：验收部署在 packs 台账 pause/删除、pack 转私有（facet packs internal API）——目录数据源自然消失，零代码。
2. **防复发闸**：向导验收/构造验收类流程（M4①/M5.3 等产物）落「验收部署用独立命名约定+默认私有」的约定；若台账无 visibility 级别可标，回退在 facade 目录组装处加「验收标记描述不渲染」的呈现规则（与 spec「no hand-maintained blocklist」一致：规则是标记驱动的，不是名单驱动的）。
3. 清单先行：任务 1 先拉线上 22 agent 全清单（名称/描述/deployedAt/turns7d），逐个标注「留/退役/私有化」，用户在 apply 时过目一次再动台账。

## 公开 status 端点的数据源与安全子集

- 数据源全为既有聚合：catalog size（bookkeeping 快照）、7 天 turns（usage ledger）、settlement pending（routes.js 既有 sweep 状态）——不新增查询面。
- 安全子集：只出三个数字+staleness 位；`/healthz` 深探针（依赖健康、内部形状）留在集群内，公开条绝不并。
- 缓存：`Cache-Control: max-age=60`（与公开详情页口径一致）；上游聚合一处不可用→该位 stale/null，整体不 500。
- 挂载：facade 新路由 `/api/wanxing/v1/status`（匿名），wanxing-web nginx 已反代 `/api/wanxing/` 前缀，零 nginx 改动。

## 详情页形态

路由化（`#/agent/<slug>`）优于抽屉：可分享、可被示例问题深链复用、目录返回不丢位。实现走 CatalogView 拆组件复用，卡片字段已齐（CatalogView.jsx:121-177），无新后端调用。

## 信任三件套的口径纪律

定价表只陈述现行计费口径（核心结算=分钟/回合，来源 bookkeeping 既有配置）；无公开费率就写「费率未公开，联系运营」——不发明数字（沿用「诚实零」纪律）。About 段与页脚五行阶梯一致（IntroView/页脚既有文案对齐，不新增主张）。

## 宿主示例页

单文件静态 HTML（vanilla JS，无构建）：postMessage init→context→ask 卡→intent 确认四步演示，指向生产 embed 车道；放 `wanxing-web/public/host-demo.html`，DocsView 链接。协议步骤与 EmbedView.jsx 既有实现逐条对应，不引入第二份协议实现语义。

## Non-goal 重申

不动计费逻辑；不做 i18n；prefs 只文档曝光不退役。
