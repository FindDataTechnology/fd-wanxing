## Why

上百 agents 长期运行需要精确的消耗可见性：token 用了多少、花在哪、趋势如何。现状三个采集点两活一盲——fleet 侧 `turn_started/turn_ended`（含 tokens、session 归属）已流进 fleet-observer 但只有 **14 天观测保留**（board 用，不是统计）；计费侧 sub2api usage_logs 是钱面真源（cell 与 runner 的 LLM 都过词元网关）但没有聚合展示面；**本地开发机 harness 的订阅额度消耗完全不可见**（唯一盲区，token-monitor 项目实证可解析）。底稿 `paas docs/memory-and-stats-plane-explore.md` 切片 3 与决策 S1-S5/Q1/Q8/Q9：内部先行、萬星 console 运营段为第一落位、sub2api 永远唯一计费真源、估算与实计费分开标。

## What Changes

- **fleet-observer 增统计面（姊妹模块，非并入观测）**：新 `stats.db`（与 fleet-events.db 同数据根、同隔离规则）——原始事件仍 14 天，统计侧落**回合级 usage 明细表 + 按 agent/pack/day/model 的滚动聚合表**（13 个月滚动 + 每日聚合永久），从既有 ingest 流同步写（不新增采集路径）。
- **统计 API**：`/api/fleet/v1/stats/*`——总览（时间窗内 tokens/回合数/活跃 agent）、按 agent/pack/model 下钻、每日序列；口径字段 `source: fleet|sub2api|local`、`basis: billed|estimated` 分开标注。
- **sub2api 聚合读通道**：observer 侧定时（小时级）经 sub2api admin API 拉用量聚合并落 stats.db（`source=sub2api, basis=billed`）——**只读 API、不读库**（防双真源），凭据走部署 secret。
- **萬星 console 运营段扩展**：机群板邻座新增「消耗」视图——时间窗选择器 + 总览卡 + agent/pack/model 下钻表 + 每日趋势；billing 与 attribution 两个口径并排展示、永不混算。
- **本地采集器（headless collector，新 `services/stats-collector/`）**：解析本机 harness 日志（v1 解析器：Claude Code `~/.claude/projects/**/*.jsonl` 的 usage 字段 + 解析器注册表可扩展 ZCode 等），按小时批投 fleet-observer ingest 的 local 通道（tailnet 直连 `10.0.0.10:31881`，collector 令牌鉴权，`source=local, basis=estimated`）。
- **非目标**：不动 sub2api 本体；不做壹座个人消耗页（产品化阶段）；不做实时流（小时级聚合够用）；不做成本换算定价表（S5 只做 billed/estimated 口径分离，金额显示仅 sub2api 口径）。

## Capabilities

### New Capabilities

- `fleet-stats`: 消耗统计面的契约——fleet 事件的统计持久化（明细+聚合+保留窗口）、统计 API 形状与口径分离纪律（source/basis）、sub2api 只读聚合通道、本地采集器的解析/批投/鉴权、console 消耗视图的行为。

### Modified Capabilities

（无——fleet-observer 的观测行为零变化：14 天保留、board、timeline 均不动；统计面是旁挂。）

## Impact

- **fd-wanxing 代码**：`services/fleet-observer/`（stats store 模块 + ingest 分流 + API 路由 + sub2api 拉取任务）、`services/stats-collector/`（新，本地跑、零部署依赖）、`wanxing-web/src/views/console/`（消耗视图）。
- **部署**：observer 滚一次镜像（stats.db 落既有 PVC）；collector 不上集群（内网机器手动/brew 服务跑）。
- **凭据**：observer 新增 sub2api admin 读凭据（k8s secret）+ collector 令牌（observer 铸）。
- **验收基线**：①生产 observer 上 stats API 出真数（fleet 口径对得上 14 天窗口内的 board 回合计数）；②sub2api 口径聚合与面板目测一致；③collector 在一台内网机实跑 24h 后 local 口径出数；④console 消耗视图浏览器眼见三口径分列、不混算。
