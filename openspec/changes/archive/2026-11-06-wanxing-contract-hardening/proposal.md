# 萬星服务韧性硬化（wanxing-contract-hardening）

## Why

三条借用出站全裸奔：registry doFetch（routes.js:63-70）、packsInternalCall（routes.js:87-91）、sub2api admin call（sub2api-admin.js:30-49）均无超时——registry 挂起即萬星回合路径挂起，admission 同步等 sub2api 挂死是调用方可感延迟；全仓仅 memory.js（5s）有超时。另有 loopback 默认值两处（routes.js:51/86，漏配 env 静默打本机空端口，2026-11-05 facet 迁机 502→503 事故同类），fleet-report 纯内存 2 万条上限无 spool 无丢弃计数（facade 重启静默丢事件）。

## What Changes

- 出站超时+降级：registry/packs/sub2api admin 三路统一 5-10s 超时；回合路径超时走既有 stale/degrade 通道返回结构化错误，不再无限等。
- env fail-fast：`SUB2API_BASE_URL`/`PACKS_INTERNAL_BASE_URL` 拔掉 loopback 默认——独立部署缺 env 启动即拒（或显式 degraded 呈现），不再静默打 127.0.0.1。
- fleet-report 落盘 spool：内存队列溢出/进程退出前刷盘，重启重放（确定性 id 保证 observer 端幂等去重，无需改 observer）；加丢弃计数暴露到 board。
- 部署清单去 IP 字面量（fd-infra-deploy）：runner→observer（agent-runner-serving.yaml:150）、facet→facade（facet.yaml:107）、platform→facet（platform.yaml:104）换 Service DNS 名——11-05 事故同类根治。

## Capabilities

### New Capabilities

- `wanxing-resilience` — 出站韧性：超时/降级/env fail-fast/事件缓冲持久性。

### Modified Capabilities

（无）

## Non-goals

- 不做熔断器/重试策略库，只做超时+既有降级通道。
- 不改 registry/sub2api/packs 契约形状，不动的只在调用侧。
- observer 侧行为不变（去重已就绪）。
- 不含 PVC 备份（wanxing-storage-longevity）。

## Impact

- `services/wanxing-facade/routes.js`、`lib/sub2api-admin.js`、`fleet-report.js`；`services/fleet-observer` 不动；fd-infra-deploy 三处清单。
- 行为变化：缺 env 时 facade 拒启（部署清单需核对 env 完整性——现网四组件 env 已齐，风险低）；上游挂起时回合返回结构化错误替代长等。
