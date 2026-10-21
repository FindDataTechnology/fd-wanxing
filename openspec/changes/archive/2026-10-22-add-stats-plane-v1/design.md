## Context

动机见 proposal.md（底稿 paas `docs/memory-and-stats-plane-explore.md` 切片 3 + S1-S5/Q1/Q8/Q9 决策），契约见 specs/。现状约束：fleet-observer（fd-wanxing `services/fleet-observer/`）已收 `turn_started/turn_ended` 等 17 类事件（SQLite `fleet-events.db`、payload 带 tokens/session、**14 天 retain**），wanxing-web console 已有 FleetView 机群板；sub2api 为计费真源（cell 与 runner 的 LLM 全过词元网关）；本地 harness 日志格式以 token-monitor 项目为参照（v1 只实做 Claude Code JSONL）。

## Goals / Non-Goals

**Goals:**

- 三口径（fleet/sub2api/local）在萬星 console 消耗视图并排可见，口径分离是硬纪律。
- 观测层零行为变化；统计面旁挂（姊妹库 stats.db）。
- collector 单文件可跑（内网任意机器），解析器可扩展。

**Non-Goals（设计级）:**

- 不做实时流式统计（小时批够内部用）；不做金额换算定价表（sub2api 金额原样透传）。
- 不做壹座个人消耗页与产品化鉴权（后续切片）。
- 不动 sub2api、不动 paas runner。

## Decisions

**D1 统计面=observer 内姊妹模块 + 独立 stats.db，不是新服务也不是并入观测库。**
理由：采集路径已通（turn 事件本来进 ingest），新服务=第二跳网络+第二部署单元（12 agents 规模不值得）；并入 fleet-events.db 则 14 天 retain 语义被搅。姊妹库同数据根同 PVC、同进程线程池写，隔离靠文件。备选「独立 stats 服务」留给规模膨胀后。

**D2 ingest 分流点=store.write 之后异步双写，统计失败不阻塞 ingest。**
理由：观测是既有 SLA，统计是新增面——失败方向必须单向（统计可缺，观测不可断）。缺口计数进 observer 日志。

**D3 sub2api 拉取=observer 内定时任务（node-cron 风格 setInterval 小时级），admin API 只读。**
理由：不改 sub2api、不读库（双真源纪律）；凭据经 k8s secret 注入 env（`STATS_SUB2API_BASE/TOKEN`）。聚合粒度=按天 per key（sub2api usage 聚合端点形状实施时对齐，若无现成聚合端点则按 key 拉明细在 observer 侧聚合——两案都不触库）。

**D4 collector 令牌=observer 铸的 `fsc_` 前缀令牌（stats.db 内独立表，与 fleet token 分族）。**
理由：local ingest 是新攻击面（tailnet 内仍要鉴权）；独立前缀便于吊销与审计。v1 手动铸造（observer CLI/env 一次性行）。

**D5 collector 解析器=v1 Claude Code JSONL（`~/.claude/projects/**/*.jsonl`，assistant 消息 usage 字段：input/output/cache 字段），位点文件 `~/.stats-collector/state.json`（per-file mtime+size+byte offset）。**
理由：token-monitor 实证该格式最稳；ZCode 等格式留注册表位（parser registry：`parsers/<name>.js` 导出 `{id, discover(), parseSince(state)}`）。批投=每小时 cron/launchd，payload `{source:"local", events:[{harness:"claude-code", ts, model, tokens_in, tokens_out, cache_read, cache_write, session}]}`。

**D6 console 视图=FleetView 同款数据通道（console 直连 observer API），新 `StatsView`。**
理由：console 已有 observer API 客户端模式；视图按 spec 场景做三口径分块。v1 不做图表库引入，表格+简单条形（CSS）先行。

## Risks / Trade-offs

- [sub2api 聚合端点形状未知（可能只有明细）] → D3 两案兜底；实施第一步先探端点形状定案。
- [stats.db 无限增长（13 个月明细）] → 明细表按月分区清+聚合行永久；量级估算（12 agents×日均百回合×400B≈2MB/天）无压力。
- [collector 解析格式随 harness 升级漂移] → 解析失败计数+跳过；位点按文件失效自动重扫。
- [口径混淆的用户体验风险] → 服务端不吐合并数（spec 硬约束）+ 前端视觉分块双保险。

## Migration Plan

observer：stats store 模块+分流+API+sub2api 任务 → 单测（store/口径/降级）→ 出片（fd-build-channel 判路，通用池）→ observer 滚版（stats.db 自动建）→ 铸 collector 令牌。collector：解析器+批投 CLI → 本机 launchd 装 → 24h 后验数。console：StatsView → wanxing-web 出片滚版 → 浏览器验收。回滚：observer 滚回旧版（stats.db 文件留存无害）；collector/令牌独立可撤。

## Open Questions

- sub2api 用量聚合端点的实际形状（有现成聚合 vs 明细拉取）——实施第一步实探后定 D3 细节。
- local ingest 是否复用 `/ingest`（加 local 事件 kind）vs 新 `/ingest/local` 端点——实施时按 EVENT_KINDS 校验逻辑定（倾向新端点，不动观测 kind 集）。
