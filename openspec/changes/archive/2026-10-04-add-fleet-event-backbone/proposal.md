# Proposal: add-fleet-event-backbone

## Why

機群观测的数据面。今天 Agent 服务的事实散落五处（registry 条目、runner 内存五态、
wanxing.db 用量、sub2api 计费、packs 部署台账），各板子各自轮询拼盘：状态是瞬时的、
无历史、无因果（「这个 agent 为什么 paused」答不出来）。萬星按万级设计（program 决
策表），唯一不返工的顺序是先立事件主干，板子全是它的投影。

## What Changes

- 新增本仓首个原生服务 **fleet-observer**：
  - **摄入端点**：服务凭据门禁（复用 runner 既有 backend 凭据语义），批量、幂等
    （事件 ULID 去重），at-least-once。
  - **事件库**：萬星数据根 per-concern SQLite，append-only；原始事件保留 14 天，
    hour×agent rollup 长存；**rollup 是所有板子的唯一查询面**。
  - **观测 API**：fleet 板数据面（五态分布/水位/延迟/滞后）+ 单 agent 生命周期时间线。
- 三路事件来源接线：
  1. **runner 直投**（paas 侧 agent-runner 加 spool 客户端：本地暂存、批量、断网重放；
     不经 registry）。
  2. **facade 上报**结算/准入事件——facade 迁入本仓前（切片②未完）跨进程 HTTP 上报，
     迁入后改同进程直写。
  3. **部署台账 diff 合成**：对 packs internal API 的缓存（切片①地基）做 diff，合成
     deployed/undeployed/paused/resumed 事件。
- 事件模型：生命周期粗粒度（deployed/undeployed/paused/resumed/woken/reaped/
  budget_killed/turn_started/turn_ended/settled），turn 类事件带 trace_id **引用**
  turn-tracing，不复制回合内容；事件携带 runner 身份，聚合不假设单 runner。

## Capability Impact

- 新增 capability：`fleet-observability`（事件摄取/存储保留/事件模型/观测 API）。
- 不动：turn-tracing（两层引用式，见 program 决策表）、wanxing-facade 的用量台账
  （caller 维度沿用 wanxing_usage，不另建 rollup）。

## Non-goals

- 板子本身：ops-console fleet 板（切片④）、wanxing-web（切片⑤）。
- 热路径修复（切片①，paas 快速通道）——但①的缓存实现是本变更台账 diff 的地基，
  排序上①宜先。
- 多 runner 放置调度（只保证观测面零返工）。
- 万级压力下的存储引擎更换（SQLite 先行，rollup 形态使升级=搬表）。

## 验收口径（首版指标）

fleet 板数据面：五态分布与总数、驻留水位（warm 数/预算 MB）、唤醒延迟 p50/p95、
退温/驱逐次数、budget kill 计数、事件摄取滞后、结算 pending 高亮。
rollup(hour×agent)：turns、error 数、minutes_billed、usd、wake p50/p95、budget_kills。
