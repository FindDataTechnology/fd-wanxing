# Tasks: add-fleet-event-backbone

## 1. 事件模型与存储

- [ ] 1.1 `services/fleet-observer/` 服务骨架 + `fleet-events.db` 建库（events 表、
      三索引、(source,id) 唯一）与 14 天惰性清理任务
- [ ] 1.2 事件 kinds 与 payload 窄字段定义（含 turn 类 trace_id 引用规则）+ 单测

## 2. 摄取端点

- [ ] 2.1 `POST /ingest`：服务凭据门禁、批量接受、ULID 幂等去重、错误批量拒绝语义
- [ ] 2.2 at-least-once 压测脚本（重复投递、乱序、乱时钟）——重放不产生重复行

## 3. runner 直投客户端（paas 侧）

- [ ] 3.1 paas `agent-runner/` 加 fleet-client：spool（落盘+内存）、批量上行、
      断网留存重放、关机 flush；五态迁移与回合首尾打点接入
- [ ] 3.2 staging 真跑：runner 停启/断网窗口内事件不丢（对账脚本核对）

## 4. 台账 diff 合成

- [ ] 4.1 bookkeeper：packs internal API 轮询快照 + diff → deployed/undeployed/
      paused/resumed 事件；周期性全量对账纠偏
- [ ] 4.2 与切片①目录缓存的 diff 逻辑共用（最小复制，②完成收敛单点）注记在案

## 5. rollup 与观测 API

- [ ] 5.1 rollup 作业（hour×agent，幂等重算）+ caller 维度不另建的口径注记
- [ ] 5.2 `GET /api/fleet/v1/board`（首版指标全字段）+ `GET /api/fleet/v1/agents/:slug/timeline`
- [ ] 5.3 摄取滞后指标（独立于来源 ts 的口径）

## 6. 上线与验收

- [ ] 6.1 GHA→TCR 镜像 + staging 部署；fd-prod 观测面首上（wanxing 数据根）
- [ ] 6.2 万级形态冒烟：合成 ≥100 万行/天事件流 24h，rollup 查询 p95 与清理任务正常
- [ ] 6.3 facade 跨进程上报接线（settled/admitted/refused），②迁入后改同进程的
      切换点记入 program 文档
