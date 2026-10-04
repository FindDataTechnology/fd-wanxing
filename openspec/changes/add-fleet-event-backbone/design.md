# Design: add-fleet-event-backbone

## 形态

单一 Node 服务 `services/fleet-observer/`（本仓），一个进程三类职责：摄取（HTTP）、
存储（SQLite）、合成（台账 diff 轮询）。部署为萬星平面自己的单元（docker 镜像，
GHA→TCR 轨道），数据根挂卷。

## 事件模型

```
event {
  id: ULID                       // 幂等去重键（facade settled 用确定性 facade-<usageRowId>）
  source: runner:<id> | facade | bookkeeper
  agent: slug                    // packs-<packId>-<agentId>，与門面 slug 同构
  runner?: <id>                  // runner 来源必带；多 runner 零返工的保险
  kind: deployed|undeployed|paused|resumed|woken|reaped|budget_killed|
        turn_started|turn_ended|settled|admitted|refused|
        state_changed|runner_stats
  ts: epoch_ms                   // 事件发生时刻（来源侧时钟），摄取时刻另记
  trace_id?: string              // turn 类事件引用 turn-tracing，不复制内容
  payload: json                  // 每种 kind 的窄字段（如 turn_ended 带 duration_ms/outcome）
}
```

`state_changed`（runner 采样器的五态迁移：warm/starting/serving/resident/draining/paused）
与 `runner_stats`（采样器随行水位：children/queued/budget_mb/budget_mb_limit/agents）是
实现中定案的两类补充——board 的五态分布与驻留水位由它们承载，粗粒度生命周期语义不变。

与 turn-tracing 的边界：本流只记「回合边界与生命周期迁移」；回合内部事件（dsh 流）
只在 turn-tracing，经 trace_id 跳转。粒度差三个数量级，存储策略不互相绑架。

## 存储

per-concern SQLite `fleet-events.db`（萬星数据根，与将来迁入的 wanxing.db 同根不同库）：

- `events` 表：append-only，索引 (agent, ts)、(kind, ts)、(source, id) 唯一。
- 保留：原始事件 14 天（惰性清理任务）；不做万级前的预分区。
- `rollup_agent_hour`：hour × agent 六字段（turns/errors/minutes_billed/usd/
  wake_p50_ms/wake_p95_ms/budget_kills）+ paused_minutes。rollup 作业幂等（按 hour
  重算覆盖），长存不清理，**板子只准查 rollup 与最近 24h 原始流**。
- 万级账：~100-200 万原始行/天 ≈ 平均 20 行/秒追加，SQLite WAL 吃得下；rollup 查询
  面规模 = agents×24 行/天。升 Postgres = 搬表，不改任何查询面契约。

## 三路来源

1. **runner 直投**：paas `agent-runner/` 加 `fleet-client.js`——内存+落盘 spool（SQLite
   或 append 文件），批量（N 条或 T 秒先到者）POST `/ingest`，非 2xx 留存重放；关机
   flush。凭据复用 AGENT_SERVING_BACKEND_TOKEN 语义（新 env 指向 observer）。
2. **facade 上报**：切片②前 facade（paas 侧）对 observer 走同一 `/ingest`（settled/
   admitted/refused）；迁入后改进程内直写库——语义同 at-least-once。
3. **台账 diff（bookkeeper）**：实现定案改用 **registry 代理清单**
   `GET /api/agents?limit=500`（一次调用同时带 path 与 metadata.paused——部署/卸载/
   升级/暂停四类事件一个源全覆盖；仍是借用契约，ADR-0015 线内）。首帧基线静默；
   空响应防抖（非空快照后骤空 = 源故障，跳过该轮不误报 mass-undeployed）。切片①
   的 diffDeployments 纯函数以最小复制共享（两仓注释互指），②完成收敛单点。

## 观测 API

board 的计数面只查 rollup（24 个 hour key）+ 有界 kind 索引窗（state_changed/回合
配对 2h、runner_stats 30min、settled/reaped 24h）——持续 1M 行/天形态下全量原始窗
扫描实测 24s，修后 1.7s（bench-fleet-million 注记在案，settled payload 解析是下一
优化点）。

- `GET /api/fleet/v1/board`：五态分布、总数、水位（warm/预算 MB）、wake p50/p95、
  退温/驱逐、budget kill、摄取滞后（now − max(ts)）、结算 pending——rollup+实时合成。
- `GET /api/fleet/v1/agents/:slug/timeline?since=&limit=`：单 agent 生命周期时间线
  （部署者页与深潜的下钻底座）。
- 门禁：backend 服务凭据（板子宿主代读）或 admin（与 ops 现行口径对齐）。

## 风险与对策

- **runner 时钟漂移**：ts 用来源侧（事件语义正确），摄取滞后指标按 observer 时钟算
  独立列，不混用。
- **diff 轮询窗口内丢事件**（两次轮询间 deployed→undeployed→deployed）：台账是慢变
  面，轮询间隔（30s 级）远小于变更频率；真丢则 timeline 以台账重放纠偏（bookkeeper
  周期性全量对账）。
- **rollup 与 wanxing_usage 口径分裂**：settled 事件的 usd 以 wanxing_usage 为准，
  rollup 只做可重算的派生值，不成为计费事实源。
