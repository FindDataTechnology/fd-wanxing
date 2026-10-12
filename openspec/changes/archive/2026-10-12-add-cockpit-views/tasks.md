# Tasks — add-cockpit-views（M4④b）

- [x] 1.1 store：usageSummaryByAgent()（单 SQL：turns7d/minutes30d/usd30d 条件聚合）
- [x] 1.2 facade：GET /console/fleet/summary（身份门；聚合+allowance 全量）
- [x] 1.3 测试：聚合口径（窗口边界/waived 排除/无行=零）/门与形状
- [x] 2.1 FleetView：部署卡片（四信号+管理动作+对话链接+详情折叠）；summary 60s 轮询
- [x] 2.2 MissionsView：列表花费水位条+详情双进度条（步骤/成本）+窗口剩余
- [x] 2.3 build 绿+浏览器卡片/进度走查
- [x] 3.1 双滚+生产走查
- [x] 3.2 归档+路线图 M4④ ✅（驾驶舱整片完结）+记忆

## 验收实证（2026-10-12 生产）

- 130/130 绿（+summary 窗口口径测试：7d/30d 边界、waived 排除、无行诚实零、ops 403）。
- 生产（sha-443c622 双滚）：舰队标签 10 张卡片全渲染——四信号列+对话链接×10+
  wx-alpha 额度水位条在场；高流量卡信号真实（doc-studio 18 回合/17 分钟/$1.70、
  planner 3/8/$0.80、fingpt 4/3/$0.30——与目录 turns7d 完全一致）；管理动作按钮全保留。
- 任务标签：建草稿任务（201）→列表行成本水位条 0/30 →详情「剩余 6 小时」+成本条；
  步骤进度条随 plan 出现（草稿无 plan=正确缺席）。
