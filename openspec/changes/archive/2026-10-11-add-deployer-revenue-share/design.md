# Design: add-deployer-revenue-share

## Context

边界结算的现行拓扑（add-serving-plans 后）：`recordUsage` 落 usage 行（settlementStatus=pending/waived，settler 选举 plan/mission/本地标记）；`trySettle` 对扣款路径调 sub2api `adjustBalance subtract`（幂等键=usage id）成功后 `usageMarkSettled`；`settlePending` 扫尾重试。chat 车道行由 `onChatRow` 按 settler（subsidy→平台键 / host→packs 内部 host-settle / 自带 key 走 /a2a 不经 facade 钱）结算。部署簿记经 deployments 缓存（routes.js，TTL+single-flight）以 slug 解析 `{packId, agentId, deployedBy}`；平台侧 `sub2api_accounts` 表与 facade 自己的 `sub2api.findUserByEmail` 都能把 owner email 变成 sub2api userId。

## Goals / Non-Goals

- Goals：ADR-0022 六条决策全部落地为可验证行为；生产探针可实证「外部真回合→部署者收益落账→面板可见」。
- Non-Goals：提现（新 ADR 之日再做）、租金（500 闸门后）、per-agent 定价（v2.1）、分成回溯历史、sub2api 收入侧虚拟记账。

## Decisions

### D1 分成资格（谁产生分成）

一个回合产生分成，当且仅当**全部**成立：

1. API 车道外部扣款：`channel` 空、`settler` 空（走 key 余额扣减的行）——plan（预付分钟本地标记）、mission（cap 记账非钱）、subsidy（平台补贴=内部）、host（部署者是消费者，ADR ⑤ 互斥）、自带 key 溢出（不经 facade 钱）全部排除；
2. `minutesBilled > 0`（outcome=ok 且有时长；waived/error 行天然无分成=ADR ④ 负保护的正向面）；
3. slug 可解析到部署且行带 `deployedBy`（部署簿记缓存）；
4. 部署者 email 可解析到 sub2api userId（`findUserByEmail`，5 分钟 TTL 缓存，对齐 subsidyHolderCache 形状）；解析失败→分成行 pending 挂账等扫尾重试（账号可能后建）；
5. 部署者 userId ≠ `row.callerId`（自己调自己的部署不分成）。

「分成=收入分成」：金额 = `minutesBilled × rateUsd ×（1−commission）`，四位小数；rate 就是 usage 行上的平台统一价（v1 无 per-agent 价）。

### D2 入账形状与幂等

- 表 `wanxing_deployer_earnings(usage_id TEXT PRIMARY KEY, deployer_user_id TEXT, deployer_email TEXT, agent_slug TEXT, revenue_usd REAL, amount_usd REAL, commission REAL, status TEXT CHECK(status IN('pending','settled','void')), created_at INTEGER, settled_at INTEGER)`。
- 顺序（crash 安全）：资格成立→`INSERT OR IGNORE`（usage_id 唯一键=天然幂等，inline 与 sweep 竞态安全）→`adjustBalance add`（userId=部署者，幂等键=`share:<usage_id>`）→成功或 duplicate 拒绝（=已入账，同 trySettle 的既有纪律）→`status='settled'`。
- 钩子挂在 `trySettle` 的两个成功出口（subtract 成功分支、duplicate 分支）`usageMarkSettled` 之后；sweep 路径复用同一函数。
- 失败语义：add 失败→行留 pending，`settlePending` 每轮重试；**不**触发 suspendCaller（分成是欠部署者的信用，不是向调用者收钱，无伤害无门槛）。
- 退款/负分成：v1 无退款路径，表无负行；未来退款经 `void`（写新 ADR 时定）。

### D3 crash 窗口补账（纪元）

usage 已结算但分成孪生缺失的窗口（`usageMarkSettled` 与 earnings INSERT 之间崩）由补账扫描收口：首次启动写 meta 纪元 `share_epoch`（本代码首启时间）；扫描 = 纪元之后 settled 且 settler 空且 minutes>0 的 usage 行 LEFT JOIN earnings 无孪生→走同一资格判定+入账。纪元之前的历史**不回溯**（部署者对过去回合无预期，回溯=无预算的负债）。补账每轮扫尾顺带跑，行数天然有界。

### D4 配置

- `WANXING_SHARE_COMMISSION`：默认 0.30，解析进 cfg，越界（<0 或 ≥1）回默认并 WARN。
- 不设独立 enable 开关：抽成=0.99 近乎关停，语义仍一致；真关停=回滚镜像。

### D5 console 面

- `GET /api/wanxing/v1/console/my/earnings`：部署者身份门（verified deployer / ops 同 my/packs 纪律，ops 拒收——无身份不可归因）；响应 `{rows:[{usageId, agentSlug, revenueUsd, amountUsd, status, createdAt, settledAt}], totals:{settledUsd, pendingUsd, turns}}`，rows 按 created_at 倒序封顶 50。
- web deploy-panel：新收益区（合计两行+近期明细），usage 视图不可达时显式降级（沿 invocation-records 的降级纪律）；i18n 按仓内既有机制补齐。

## Risks / Trade-offs

- **部署簿记缓存陈旧导致 deployedBy 误归属**：窗口=缓存 TTL（秒级），且部署升级 upsert 单行，风险面与 host-settle 寻址相同——接受。
- **findUserByEmail 依赖 sub2api admin 面**：与补贴结算同依赖，degraded 时分成挂 pending 等扫尾，不阻塞扣款主路径（钩子在结算成功之后，异常吞掉只记日志）。
- **混合余额的心理账户**：v1 接受净额混同（ADR 后果栏已声明），earnings 表即明细源。

## Migration Plan

SQLite `CREATE TABLE IF NOT EXISTS`，零迁移；旧部署无 earnings 行=正确初始态（纪元挡住回溯）。上线走 fd-wanxing 标准镜像线（facade+web 同滚）。

## Open Questions

无——语义全部由 ADR-0022 锁死；两旋钮（抽成/提现）中提显式延迟。
