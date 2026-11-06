# 萬星存储长跑（wanxing-storage-longevity）

## Why

观测面「按万级设计」但长跑有洞：rollup 补算窗仅 48h（observer.js:184-186,292）× 原始事件 14 天保留 = 宕机超 48h 即产生**永久**统计空洞，且 rollup 是唯一查询面、后果放大（2026-11-02 cheap-5 节点重启已实证单点）；facade 侧 `wanxing_requests` 幂等行/`wanxing_mission_writebacks` 只增不减、`callback-audit.jsonl` 纯 append 无轮转；两 PVC（fleet-observer-data 5Gi / wanxing-facade-data 2Gi）local-path 钉死 cheap-5、replicas=1、无备份方案。

## What Changes

- rollup 补算窗改为「自上次 rollup 进度起、上限=保留期（14 天）」：宕机恢复后自动补齐窗口内空洞，消除永久丢失。
- facade 侧保留策略：`wanxing_requests` 幂等行、`wanxing_mission_writebacks` 加 TTL 清理（账本表 wanxing_usage 长存不动）；`callback-audit.jsonl` 按日轮转+限量。
- PVC 备份：两库 SQLite 增加定期快照导出（节点上 cron 或 sidecar，方案在 design 定），备份产物落到 cheap-5 之外；并记 PORTS.md 台账补 31880/31881 两行（fd-infra-deploy）。
- 顺手清理：observer.yaml/facade.yaml 两处过时 TODO(go-live) 注释。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fleet-observability` — rollup 补算窗口要求（进度驱动、覆盖保留期）、事件不因宕机永久丢失。
- `wanxing-facade` — 台账辅助行保留策略、回调审计轮转。

## Non-goals

- 不迁 Postgres（爆量再议，架构不动）。
- 不做多副本/漂移（单节点是现行拓扑裁决，备份解决丢数据不解决可用性）。
- 不改 rollup 表结构与查询面。

## Impact

- `services/fleet-observer/observer.js`（rollupPass 参数化）、`services/wanxing-facade/routes.js`（TTL tick）、`callbacks.js`（轮转）；
- fd-infra-deploy：PORTS.md、可能新增备份 CronJob；
- cheap-5 之外的备份落点（宿主目录或对象存储，design 定）。
