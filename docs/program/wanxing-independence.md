# 萬星独立运行 Program

> 2026-10-04 grill 定案（`/grill-with-docs`，19 问全落）。本文件是伞：只记共识与切片，
> 每个 change 的细节在其 openspec proposal 里。

## 已定决策（不许重开）

| # | 决策 |
|---|---|
| 定位 | 萬星 = 独立项目 + 产品条线（constellation 线），非 paas 内能力线 |
| 规模 | 数据面按万级设计（rollup、批量搬运、分页 day 1 就有），实现随实际量级走 |
| 独立阶梯 | L1 品牌面 + L2 部署面现在做；L3 交付面守「借用契约」纪律保持可达；不一次性大搬仓 |
| 边界 | 萬星平面：facade、观测面、wanxing-web、runner。借用：謙面 registry + packs 台账、sub2api |
| 观测面 | ops-console（内部板宿主，留 paas）改读萬星观测 API；「塔台」一词废；对外产品面走 wanxing 域 |
| 事件模型 | 生命周期事件流（粗粒度）与 turn-tracing（回合内，已有）两层引用式衔接，trace_id 引用不复制 |
| 事件来源 | 三路：runner 直投萬星摄入端点（spool+at-least-once+ULID 去重，不经 registry）；facade 自写（迁入前跨进程）；部署台账 diff 合成 |
| 存储 | 萬星数据根 per-concern SQLite：原始事件保留 14 天，hour×agent rollup 长存；rollup 是唯一查询面；爆量升 Postgres=搬表不改架构 |
| 多 runner | runner 身份进 schema、聚合不假设单 runner；放置调度不做 |
| 部署者面 | 按外部租户产品级做（权限/配额/账单对齐），v1 用户是萬星运营号（吃狗粮） |
| web 门面 | 独立前端工程（本仓 `wanxing-web/`）+ 独立发布线（GHA→TCR 静态镜像挂 wanxing 域，API 同域反代 facade） |
| 首版指标 | fleet 板：五态分布/驻留水位(warm数/预算MB)/唤醒延迟p50p95/退温驱逐/budget kill/摄取滞后/结算pending；部署者页：状态/24h·7d 回合时长花费/允许清单/生命周期时间线；rollup(hour×agent)：turns/error数/minutes_billed/usd/wake p50p95/budget_kills。caller 维度沿用 wanxing_usage 不另建 |

## 切片

| # | 切片 | 仓 | 依赖 | 状态 |
|---|---|---|---|---|
| ⓪ | scaffold 本仓（openspec/CONTEXT/ADR-0001/本文档） | fd-wanxing | — | ✅ 2026-10-04 |
| ① | 热路径修复：目录 O(N) 全量拉取 → slug 索引+缓存+分页 | paas | — | 待 propose（bug 级快速通道；缓存兼职③的台账 diff 探测器） |
| ② | L2 拆面：facade 独立部署 + L1 wanxing 域名 + facade 迁入本仓 | paas→fd-wanxing | ①宜先 | **代码+镜像+清单就绪 2026-10-04**（change `add-facade-extraction`；spec fork 含①效果；44/44 测试绿；余 GHA 首跑/staging 四点/DNS+GitOps 部署窗口。**切换点修订**：facade 与 observer 保持各自独立部署，fleet-report 跨进程上报保留——observer 有状态 PVC、facade 可水平扩，并进程会耦死扩缩容） |
| ③ | 事件主干+rollup（fleet-observer 服务，本仓首个原生组件） | fd-wanxing | 可与②并行（facade 迁入前跨进程上报） | **代码完成 2026-10-04**（13/14；镜像 workflow 已随②就绪，待 GHA 首跑+staging 首上；上报按②修订为跨进程长期形态） |
| ④ | ops-console fleet 板（改读③的观测 API） | paas | ③ | **完成 2026-10-04**（paas add-fleet-board：fleetBoard 源+总览渲染，三态降级验证过；上线随 ops-console 下次滚动，env FLEET_BOARD_URL/TOKEN 指 observer） |
| ⑤ | wanxing-web：公共目录+部署者控制台+文档门面 | fd-wanxing | ③（数据）②（同域反代）；骨架可并行起 | 待 |

## 硬依赖备忘

- ② 必须先于「事件库落位 facade 进程内」的一切假设：③ 先以独立服务立身，facade 迁入
  （②完成）后才改同进程直写结算事件。
- ① 的目录缓存是 ③ 台账 diff 合成器的地基，两处共用一份实现。
- 治理随代码走：facade/runner 迁入时其 paas specs（wanxing-facade、agent-runner、
  a2a-agent-serving、agent-residency、agent-delegation 等）fork 当前文本入本仓，paas 侧
  标 moved；in-flight 的 Agent platform program 切片在 paas 原地做完。
