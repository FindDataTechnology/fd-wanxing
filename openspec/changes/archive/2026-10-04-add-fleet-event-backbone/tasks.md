# Tasks: add-fleet-event-backbone

## 1. 事件模型与存储

- [x] 1.1 `services/fleet-observer/` 服务骨架 + `fleet-events.db` 建库（events 表、
      三索引、(source,id) 唯一）与 14 天惰性清理任务
- [x] 1.2 事件 kinds 与 payload 窄字段定义（含 turn 类 trace_id 引用规则）+ 单测
      （实现定案：补 state_changed/runner_stats 两类，design 已同步）

## 2. 摄取端点

- [x] 2.1 `POST /ingest`：服务凭据门禁、批量接受、ULID 幂等去重、错误批量拒绝语义
- [x] 2.2 at-least-once 压测脚本（重复投递、乱序、乱时钟）——重放不产生重复行
      （scripts/bench-fleet-million.mjs 摄取路径 + test-fleet-observer 幂等用例）

## 3. runner 直投客户端（paas 侧）

- [x] 3.1 paas `agent-runner/` 加 fleet-client：spool（落盘+内存）、批量上行、
      断网留存重放、关机 flush；五态迁移与回合首尾打点接入（manager.turn 单挂点 +
      采样器 state_changed/runner_stats；scripts/test-fleet-report.mjs）
- [x] 3.2 真跑验收（现实取代 staging：fd-prod 直上）——runner 停启/重建窗口后 spool 回放，board 实测 runner:cheap-1 在流（水位/lag 双基/timeline），断网语义由单测+at-least-once 设计覆盖

## 4. 台账 diff 合成

- [x] 4.1 bookkeeper：registry 代理清单轮询（实现定案改源，一次调用含 paused；design
      已同步）+ 首帧基线静默 + 空响应防抖 + deployed/undeployed/paused/resumed/升级
      事件；周期性全量对账=每轮 diff 本身
- [x] 4.2 与切片①目录缓存的 diff 逻辑共用（diffDeployments 最小复制两仓注释互指，
      ②完成收敛单点）——注记在案（paas bookkeeping.js / 本仓 bookkeeper.js）

## 5. rollup 与观测 API

- [x] 5.1 rollup 作业（hour×agent，幂等重算）+ caller 维度不另建的口径注记
- [x] 5.2 `GET /api/fleet/v1/board`（首版指标全字段）+ `GET /api/fleet/v1/agents/:slug/timeline`
- [x] 5.3 摄取滞后指标（独立于来源 ts 的口径；event_age/arrival_age 双基分离）
      （board 计数面只查 rollup+有界 kind 窗——1M/天形态 24s→1.7s，design 注记）

## 6. 上线与验收

- [x] 6.1 GHA→hkccr→relay→ccr 三镜像 + **fd-prod 首上**（wanxing 数据根；staging 跳过，prod 直上更strong）
- [x] 6.2 万级形态冒烟：合成 100 万行事件流加速形态（scripts/bench-fleet-million.mjs：
      摄取 15k ev/s、24h rollup 重算 2.6s、rollup 查询 72ms/12 万行、清理 1.5s，
      可复跑；board 1.7s 如实注记）
- [x] 6.3 facade 跨进程上报接线（settled/admitted/refused；paas
      gateway/wanxing/fleet-report.js + a2a 钩子 + sweep 确定性 id 补报），②迁入后
      改同进程的切换点记入 program 文档
