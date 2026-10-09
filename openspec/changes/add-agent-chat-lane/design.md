# Design: add-agent-chat-lane

## Context

门面（services/wanxing-facade）的 API 车道已完整：sk- 键探活即计费门 → 准入（可见性/允许名单）→ 限流/单槽/幂等 → 分钟记账（wanxing_usage）→ 结算 sweep。console 已有 Logto PKCE 会话（logto-auth.js，验 ES384 + email 允许名单）。部署行带 `deployedBy`（packs internal `/api/packs/internal/deployments`）；paas 侧 `deployment_keys` 每 agent 一把部署者计费键。共享 tenant `auth.finddatatech.cloud` 注册已开放。词汇与计费模型定案见根 CONTEXT.md 与 ADR-0002。

## Goals / Non-Goals

**Goals:**
- 对话车道与 API 车道共用同一准入内核与转发路径，账本同源分渠道。
- 调用者/结算方分离落在账本结构里，不在代码里特判。
- 主人池的钱不离开謙面：键值不出 packs 平面。

**Non-Goals**（设计层新增，scope 层见 proposal）：
- 不做对话正文的任何服务端形态（连临时缓冲也不落盘）。
- 不改 API 车道任何现有行为（含限流默认值、结算节奏）。

## Decisions

### D1 对话路由是独立路由族，不共用 `/a2a/:slug`

`POST /api/wanxing/v1/chat/:slug`（message/send | message/stream，协议语义同 A2A）。备选是同端点双凭据类（Bearer sk- vs Bearer ID token）——被否：凭据语义按路由分明可读，spec 层 API 车道零改动，自带键桥=浏览器直接打既有 `/a2a/:slug`（已存在，零新代码）。两路由族在 core.js 内共享 admit/checkRpm/slot/idempotency 同一内核函数。

### D2 访客鉴权 = tenant ID token 验签，无名单

复用 logto-auth.js 的 JWKS/ES384/issuer/audience/expiry 验证，抽出 `verifyIdToken(token, { allowlist: null })` 形参；console 门不变。浏览器把 ID token 作 Bearer 直打 chat 路由（token 短时效，配合 web 端现有 refresh 旋转）。同一个 Logto SPA app（audience 相同）；将来要给访客单独开 app 时只是换 env，不影响契约。注册开放是 tenant 现状，不在本 change 动。

### D3 账本结构：wanxing_usage 加列 `channel`、`settler`、`visitor_sub`

- `channel TEXT NOT NULL DEFAULT 'api'`（api|chat）；`settler TEXT`（api 车道恒等于 caller；chat 车道 = subsidy|host|visitor-key）；`visitor_sub TEXT`（chat 车道的 tenant sub，caller_id 存脱敏展示名）。
- 额度**不设独立计数器**，一律由账本聚合派生（单一事实源）：补贴用量 = `SUM(minutes_billed) WHERE channel='chat' AND settler='subsidy' AND visitor_sub=? AND day(started_at)=?`；主人池已用 = `WHERE settler='host' AND agent_slug=?`。SQLite 聚合在准入路径上可接受（量级：人类聊天）。
- 日界取 Asia/Shanghai 平台时区（与运营语义一致），不做用户本地时区。

### D4 准入瀑布（chat 车道）

```
访客token验签 → agent存在/public/paused检查
  → chat开放检查: 补贴开关开 OR 主人池余额>0  (否则 CHAT_NOT_OPEN)
  → 限流: chat独立RPM(默认6/分/访客) + (caller,agent)单槽
  → 结算方判定(回合开始前): 补贴余额>0 → subsidy
                            主人池余额>0 → host
                            否则 → 拒 402 CHAT_ALLOWANCE_EXHAUSTED(带自带键提示)
  → 转发内核(同API车道) → 记账(channel=chat, settler=判定结果)
```

判定发生在回合前、按分钟向上取整预占（取整规则与结算一致）；回合结束后实况记账，超预占部分照记（池可能被打穿，见 R2）。

### D5 主人池实扣 = packs internal 结算端点（键不出謙面）

paas 侧新增 `POST /api/packs/internal/deployments/:packId/:agentId/host-settle`（循 config 内部孪生的按部署寻址约定，实现期由 `:agentPath` 单段形状修正为 `packId/agentId` 双段——Express 单段参数容不下含斜杠的 agentPath；body: `{minutes, usage_id, rate_usd_per_min?}`，幂等键=usage_id）：packs 侧取该部署的 `deployment_keys.key_value` 解析持有人后经 sub2api 扣款。facade 不接触键值——与「key 不过门面」纪律一致。平台补贴结算 = facade env 配的平台键（`WANXING_SUBSIDY_KEY`，扣平台自己的 sub2api 账户），走既有结算 sweep 同一通道。结算失败重试/挂起语义沿用现有 sweep。

### D6 主人池配置面：facade 自有存储 + deployer 门禁

`wanxing_host_allowance(agent_slug PK, limit_minutes, updated_by, updated_at)` 存 facade DB（部署服务的配置归 packs，垫付上限是萬星计费事）。写门禁：请求身份 = 该部署 `deployedBy`（email 匹配）或 ops 令牌；读（余额）随 chat status 与 console 记录视图给出。

### D7 chat status 端点供页首渲染

`GET /api/wanxing/v1/chat/:slug/status`（访客凭据；匿名返回仅 chatAble+reason）：`{chatAble, reason, subsidyRemainingToday, hostPoolRemaining, agent: {name, description}}`。余额展示分钟+粗估回合数。

### D8 调用记录 API 与脱敏

`GET /api/wanxing/v1/console/deployments/:slug/usage?days=30`（该部署 deployer 或 ops）：`{byCaller: [{caller, channel, turns, minutes, lastAt}], activity: [最近50条 {at, channel, outcome, minutes}]}`。访客 caller 展示脱敏 email（`z***@gmail.com`）；ops 令牌请求带 `?unmasked=1` 看全量。聚合按调用者+渠道分组。

### D9 web 形状

- `#/chat/:slug` ChatView：登录门（复用 auth.js）→ status 渲染余额 → 输入框 + SSE 流式回复（fetch+ReadableFrame，同 docs 样例协议）→ 历史存 localStorage（per slug，容量上限截断）→ 耗尽态渲染 402 结构错 + 自带键输入框（key 存 localStorage，后续请求直接打 `/a2a/:slug`）。
- catalog 卡片：chatAble 时加「对话」CTA（chatAble 来自卡片数据增补的 chatable 布尔，目录 API 顺手带上）。
- console 部署详情两面板：调用记录（D8 渲染）+ 对话额度（主人池限额输入、deployer 可写）。

### D10 env 面

`WANXING_CHAT_SUBSIDY_ENABLED`(默认 false)、`WANXING_CHAT_SUBSIDY_DAILY_MINUTES`(默认 10)、`WANXING_CHAT_RPM`(默认 6)、`WANXING_SUBSIDY_USER_ID`(专用补贴账户 id——部署定案 2026-10-09：补贴走新开专用账户，直配用户号免键，上游无管理侧铸键；优先于 key)、`WANXING_SUBSIDY_KEY`(键路径备选)、`TZ_DAY_BOUNDARY`(固定 Asia/Shanghai，预留)。全 env 可重指，无代码常量。

## Risks / Trade-offs

- [R1 免费面被脚本薅：登录+分钟记账本身有成本，但注册开放意味着键农可批量开号] → chat 独立 RPM 6/分 + 单槽 + 每日补贴 10 分钟的绝对上限把单号日耗封顶在 ¥级；后续可叠 per-IP/设备信号，不在 v1。
- [R2 主人池被打穿：回合前预占取整与实际分钟差，或并发放行边界] → 池是限额不是担保；超支部分照实记账并在 console 记录里可见（诚实欠费展示），账不丢。
- [R3 补贴开关默认关，上线时忘开则全平台对话面静默关闭] → status 的 reason 明确带 `subsidy_off`；部署清单里把「开补贴」列为显式上线动作。
- [R4 ID token 作 Bearer 体积大、每请求都带] → chat 频率低（人手速），无缓存必要；过期由 web 端 refresh 旋转处理（基建已有）。
- [R5 部署者 email 与 Logto email 不一致时主人池无法配置] → 门禁按 deployedBy 精确匹配；不匹配时 ops 令牌仍可配（兜底通道）。

## Migration Plan

1. paas 先上 packs internal host-settle 端点（向后兼容，纯新增）。
2. facade 滚新镜像（含 chat 路由/账本列迁移 SQLite ALTER TABLE ADD COLUMN，老行默认 api）——此阶段补贴默认关，无行为变化。
3. web 滚新镜像（chat 视图/面板就位）。
4. 运营显式开 `WANXING_CHAT_SUBSIDY_ENABLED` + 配平台补贴键 → 对话面上线。
5. 回滚：关补贴开关即回到「仅主人池」态；facade/web 回滚无数据迁移问题（新列可留）。

## Open Questions

- 平台补贴键用现有平台账户还是新开专用账户（记账隔离更干净）——部署时定，不阻塞实现。
- 目录卡片 chatable 布尔的缓存时效（目录走快照缓存 15s TTL，池变动最迟 15s 可见——可接受，无需另做）。
