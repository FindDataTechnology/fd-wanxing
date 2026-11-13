# design — 萬星域内关联收口

## 1. 现状（带证据）

**出向有契约，入向无契约。**

`wanxing-borrowed-contracts` 只登记了萬星借出的四条边界，而兄弟线对萬星公开面的读取没有一处登记、没有一处形状测试：

| 消费者 | 读取点 | 钉住的字段 |
|---|---|---|
| 谦面供给脊柱 | `paas/facet/supply-catalog.js:255` → `/api/wanxing/v1/agents` | `agents[].slug/name/description/version/tags/skills/chatable/annotation`，`asOf` |
| 谦面静态门厅 | `paas/scripts/plaza-export.mjs:695,732` → `/api/facades-catalog`（二跳） | 同上 + `status`/`deployment` |
| 壹座主人跨线 | `paas/server/routes/fleets.js:1648` → `/api/wanxing/v1/ops/usage` | `byCaller[].email/turns/minutes/usd/pending` |
| 壹座 ops-console | `paas/services/ops-console/index.js:337` → `/api/fleet/v1/board` | `states{}`、`runners{}.children/queued/budget_mb/budget_mb_limit/agents`、`ingest_lag[].source/event_age_ms/arrival_age_ms`、`settled_pending.count/usd`、`wake_ms.p50/p95`、`agents_total/turns/errors/budget_kills/reaped/minutes_billed/usd/window` |
| 萬星 web 控制台 | `wanxing-web` 经 facade 透传 `/api/fleet/` | 同上 |
| 识律（浏览器） | `fd-lex/web/src/console/WanxingCopilot.tsx:16` 硬编码 `WANXING_ORIGIN` → `${origin}/copilot.js` | loader 脚本地址 + `wx-copilot-*` 宿主协议（init/context/identity/intent/state）+ `/api/wanxing/v1/lines/lex/copilot` 的解析结果 |
| 柏讯（服务端） | `fd-wire/api/fd_wire_api/demands/wanxing.py` → `POST {WANXING_A2A_BASE}/api/wanxing/v1/a2a/{slug}` | A2A 同步回执形状（`message_id`/`idempotency_key`/`reply_excerpt`）+ 错误码语义（401/403/协议失配） |
| 萬星运维 MCP（`wanxing-ops-mcp`） | 8 个工具：`/agents`、`/a2a/{slug}/.well-known/agent-card.json`、`/a2a/{slug}`（回合）、**以及壹座的 `/api/packs/{id}/deployments/{agent}/callers|pause|resume`** | 目录与卡片字段、A2A 回执、部署者管理动作的响应形状 |
| 数据工厂（`fd-industry-data`） | `scripts/alert_selfcheck.py` / `scripts/restaurant_alerts.py` → `WANXING_SPIDER_HEAL_URL` + `WANXING_SPIDER_HEAL_KEY` | A2A 工单投递（**已断**，见下） |

**这一条不是假设，已经炸过了。** `fd-industry-data/config/alert-selfcheck-known.json:5` 记着实测结论：工单链的 a2a 路由从平台摘挂搬到萬星门面后，**spider-heal 不在门面的 18 个 public agent 里**，原 slug 打门面得 `404 AGENT_NOT_FOUND`（2026-11-08 实测）。处置是"告警用途已由邮件通道覆盖，代码保留不删"——即一条完整的调用链**静默死亡**，只在一处代码注释和一份 JSON 里留了记录，而且那份记录自己把路径写成了 `/api/wangxing/`（拼错）。这就是「入向无契约」的代价：搬迁方不知道谁在调，调用方也不知道该找谁。

**另一处结构性重复：同一条状态有两个写入口。** 暂停/恢复的真相是 registry 的 `metadata.paused`（runner 轮询），但有两个门可写：平台 `gateway/packs.js:2971-2972`（`POST /api/packs/:id/deployments/:agentId/{pause,resume}`）与门面 `services/wanxing-facade/console.js:252`（`POST /api/wanxing/v1/console/deployments/:slug/{pause,resume}`）。两个门写同一份真相——这点是对的；但**写这份真相的逻辑本身是两份**：门面 `console.js:36 setPaused` 的注释自认「Mirror of paas lib/agent-serving.js setAgentPaused（**minimal copy, keep in lockstep until ②-收敛**）」，而 `paas/lib/agent-serving.js:434` 确实有一份等价实现。那句话是 2026 年 10 月写的，至今没收敛。写路径的漂移比读路径更难发现：两个门都能用，只是行为在某天开始不同。

上表任何一个字段改名，今天没有任何测试变红。

**五条消费者的纪律水平完全不同，这本身是结论：**

| 消费者 | 编址方式 | 契约是否被钉住 | 评价 |
|---|---|---|---|
| 谦面脊柱 | env `WANXING_FACADE_URL` | 无形状测试 | 中 |
| 壹座主人跨线 | env `WANXING_FACADE_URL` | 无形状测试 | 中 |
| 壹座 ops-console | env `FLEET_BOARD_URL` | 无形状测试 | 中 |
| **识律** | **源码内硬编码域名** | 无 | **最差** |
| **柏讯** | env ×4（`WANXING_A2A_BASE`/`WANXING_AGENT_SLUG`/`WANXING_CALLER_KEY`/`WANXING_A2A_TIMEOUT`）+ 缺省 | 2026-10-12 生产实弹探针冻结 + 类型化错误 | **最好** |
| 萬星运维 MCP | `line-manifest.json` 给 `public_base_url` + `WANXING_OPS_TOKEN` | 测试断言了端点路径，未断言响应形状 | 中上 |
| 数据工厂 | env `WANXING_SPIDER_HEAL_URL`/`_KEY` | 无（已断且只记「已知不修」） | 差 |

柏讯的做法就是本标准该长的样子（`fd_wire_api/demands/wanxing.py` 头注释）：env 可重指、冻结形状写在文件头、键值绝不入异常文案/日志/repr、幂等键按内容 sha256 派生、并明写「**绝不调** platform 旧 facade（双部署两份 SQLite，白名单/幂等互不相通）」——那句话恰好证明「唯一出面是萬星域」这条裁决在生产上是必需的，不是纸面纪律。

识律那条的失效方式最难查：域名一变，`copilot.js` 404，而**报错的代码在 loader 里，loader 根本没加载**，页面只是"右下角什么都没有"。能力缺失伪装成产品决定。

**义务已写死，填报是空的。**

`paas/openspec/specs/supply-catalog/spec.md:56` 要求服务面在状态可得时提供状态；`supply-catalog.js:199` 用 `a.status ?? "unknown"` 兜底；`plaza-export.mjs:190` 同样是 `f.status ?? "unknown"`，其测试夹具（`scripts/test-plaza-export.mjs:323`）甚至构造了 `status: "running"` 的样本。而 facade 的目录条目（`services/wanxing-facade/a2a.js:521-545`）**不含 status 字段**。于是生产上永远是 unknown，夹具与生产是两个世界。

**第五条借用边界漏登记。**

`services/wanxing-facade/selfservice.js:31-45` 以 `FACET_BASE_URL` + `FACET_INTERNAL_TOKEN` 转发身份直调谦面 packs 面。它与 registry/packs 台账/sub2api/runner 同级，但不在 spec 的四条清单里。

## 2. 决策

### D1 · 状态走读侧投影，不建写侧推送

供给域博弈文档写的是「实例回报 萬星→脊柱」。本 change **不**落成 facade 主动推送，改为把状态放进脊柱已经在轮询的读面。

理由：
- 脊柱已有 TTL 刷新 + last-good-on-failure + `source_absent` 的诚实缺省语义（`supply-catalog.js:26-31` 头注释即此纪律）。加一个字段，零新语义。
- 推送要新开脊柱入站端点 + 新凭据 + 新失败模式（facade 成了脊柱的写者），把单向借用变成双向依赖。
- 推送的收益（更低延迟）对静态门厅无意义——门厅本来就是发布事件触发生成的。

代价：状态新鲜度上限 = 脊柱的 TTL（默认 300s）。接受。

**备选（否决）**：facade 定时 POST 到脊柱 ingest。否决理由如上；且脊柱的 ingest 目前只服务 runner 心跳与 cell 遥测，接入第二个写者会污染其 at-least-once 语义。

### D2 · 状态词汇与派生真值表

只用 facade 已经持有的两个事实：部署行的 `paused`、自家账本的 `turns7d`。

| paused | turns7d | 部署快照 | status |
|---|---|---|---|
| true | — | fresh | `paused` |
| false | > 0 | fresh | `serving` |
| false | 0 | fresh | `idle` |
| — | — | hard-stale / 源不可达 | `unknown` |

关键约束：**沉默不等于健康**。零回合落 `idle` 而不是 `serving`；快照陈旧落 `unknown` 而不是沿用上一次的 `serving`。这与 `wanxing-facade` 既有的「honest absence」纪律（`fleet-observability` 的 health 语义同源）一致。

**备选（否决）**：读 observer 的 `/api/fleet/v1/board` 拿派生 health 作为第二判据。否决理由：那是跨进程二次跳转，把目录的 P99 绑到观测面的可用性上；且 health 的窗口（`FLEET_HEALTH_WINDOW_HOURS`）与目录的 7 日口径不同，混用会产生第三种口径。目录要保持「一条读路径」。

`status_as_of` 取本次派生所用的快照时刻（不是 `Date.now()`），使外部消费者能区分「新鲜的 idle」与「冻结的 unknown」。

### D3 · 策展是标签，不是准入（原先的「改读脊柱投影」判断已撤回）

**先纠正一处事实错误。** 本 change 初稿断言「萬星从 `/api/packs` 原始行取 `category`/`featured`，与谦面脊柱对同一包的策展判断是两次独立解读，应改读脊柱投影」。核查后不成立：

- `facet/supply-catalog.js` 只暴露三个端点——`/api/supply-catalog/species`、`/api/facades-catalog`、`/api/data-anchors-catalog`。**没有 pack 投影端点**，所以「改读脊柱投影」这条任务不可实现。
- 而 `facet/marketplace-json.js:35` 已经写着「**The ONE listing rule**」：所有市场形态的面都走 `loadListedPacks`，其准入 = public ∧ non-unlisted ∧ curated（`category ∨ featured`），且 `FACET_MARKETPLACE_PACK_IDS` 白名单**替换**而非取交集。
- `category`/`featured` 的唯一存储源是 `packs` 表的两个列（`gateway/packs.js:81-82`），`GET /api/packs` 只是它的读面（`:422-438`）。门面读到的就是这份数据。**不存在两个解读。**

**真正存在、且必须钉住的差异是准入，不是取值。**

| | 市场形态的面 | 萬星目录 |
|---|---|---|
| 未策展的包 | **隐藏**（curated ∨ whitelist 才入列） | 照常出现（只要已部署且公开） |
| 运营白名单 | **替换**整个入列集合 | 无影响 |
| 策展字段的角色 | **过滤器** | **标签** |

这个区分是对的、也必须保持：一个已部署、对公众可用的 agent，即使从没被策展，也真实存在且可被调用——目录隐掉它等于谎报。反过来，如果运营把白名单收窄到 3 个包（`FACET_MARKETPLACE_PACK_IDS`），萬星的实例目录**不能跟着只剩 3 条**。

所以 D3 的正确内容是**冻结这个不对称**，而不是消除它：门面沿用既有 `/api/packs` 读面取标签值（唯一存储源，无需改），并显式规定「不套用市场准入规则」。验收要能证明两件事：未策展的部署仍在列；白名单不影响本目录。

**关于「软环」的更正**：原稿说「facade 读脊柱、脊柱读 facade」构成软环。pack 侧的软环不存在（脊柱没有 pack 端点）；真实的单向依赖是**脊柱读 facade 的 facade 物种**（`supply-catalog.js:255`），那是供给域 D1 的设计，不是环。仅当门面未来去读脊柱的 facade 投影时才会成环——本 change 不做，也规定不做。

### D4 · 契约修订号 + 跨仓夹具

- `contracts/wanxing-public-api.v1.json`：JSON Schema，覆盖三个被消费读面的**响应形状**，顶层带 `x-contract-rev`（整数字符串）。
- 萬星侧：一条测试按 schema 校验真实路由的响应（producer 侧）。
- 兄弟线侧：消费者各持一份副本 + 一条按同一 rev 校验的测试（consumer 侧，由 paas 仓 change 承接）。
- 根层 `scripts/check_wanxing_contract_drift.py`：比对两仓副本的 rev 与形状，不一致非零退出。

为什么不做成共享包：跨仓 import 违反借用契约（禁进程内耦合）。契约以**文件**为界，不以代码为界。

### D5 · chatability 必须用真实暂停态（发现的现存缺陷）

核查 status 派生时撞到一处真 bug，顺手修：

```
目录 /agents  (a2a.js:534)                    chat 门禁 (chat.js:173-175)
chatability({ exists:true, slug,               (state) => Boolean(state.exists)
  visibility:"public", paused:false,  ──┐        && state.visibility !== "private"
  entry })                              │        && !state.paused
                                        │        && (subsidyOpen() || hostRemaining > 0)
                                        └─ 写死 false ⇒ 暂停态永远被忽略
```

后果是一条完整的错误引导链：目录标 `chatable: true` → 萬星 web 卡片给出「进入对话」入口 → 谦面脊柱把 `chatable` 复制进门厅（`supply-catalog.js:200`）→ 访客点进去，chat 车道回 `423 AGENT_PAUSED`。而同一条 facade 的 `/chat/:slug/status` 走 `agentState`（暂停态是真的），回答 `chatAble: false, reason: "agent_paused"`。

**同一条事实，两个端点，相反答案。** 这不是设计分歧，是漏传参。

**为什么生产上暂时看不出来（必须写清，否则会被误判为"假 bug"）**：2026-11-13 线上实测——目录 18 个公开条目、0 个带 `status`、18/18 `chatable: true`；同 18 个 slug 的 `/chat/:slug/status` 也全是 `chatAble: true`（`subsidy: "on"`，且没有暂停中的 agent）。两面现在恰好一致，是因为**现形条件没被触发**：①有 agent 被暂停，或 ②补贴关掉而某 agent 无主人池。缺陷在代码里是确定的（`paused: false` 写死），复现只能在单测里造一个 `metadata.paused=true` 的 agent，不能指望线上撞见。

顺带一个观察：18/18 全 `chatable: true` 意味着这个标记**目前不携带任何信息**（全真等于无信号）。补贴全开时这是必然结果、不是缺陷；但它也说明「目录的 chatable 标记」至今没有被人当作筛选依据——所以修它不会破坏任何现有消费方的预期。

修法：循环里**已经取到了 entry**（`entryFor(dep.slug, dep)`，60s TTL 缓存），直接传 `paused: entry?.metadata?.paused === true`——与 `agentState` 的判定逐字相同，零新增读取。用 `agentState` 会额外走一次 15s TTL 的暂停态复核，对目录枚举面是没必要的开销。验收成对断言：同一 agent 的目录 `chatable` 与状态端点 `chatAble` 必须相等。

### D6 · 状态的可见性边界

`status` 是公开信息吗？是——它只表达「这个公开 agent 此刻在不在一线」，与既有的 `chatable` 同级，不泄漏配额、地址、健康细节。`status_as_of` 同理。**不**公开 paused 的原因、不公开失败计数。

## 3. 不做（划界）

- env 表统一、`slugFor` 六份副本收敛 → 姊妹 change `unify-wanxing-shared-semantics`。
- paas 死替身摘除、paas 侧消费者测试 → paas 仓 change `retire-wanxing-twin-face`。
- 不新增健康判定、不接心跳推断。
- 不改 A2A 协议、计费口径、准入规则、身份阶梯。

## 4. 风险

| 风险 | 处置 |
|---|---|
| 目录 `status` 被误读成 SLA 承诺 | 公开文档（`docs/wanxing-serving-api.md`）标注：状态是 7 日活跃口径的投影，不是可用性承诺；`unknown` 是合法终态 |
| packs 读面（`/api/packs`）不可达导致类目全丢 | 既有降级语义保留（无类目、不成组、不阻塞）；验收含此场景 |
| 契约 schema 与实现漂移 | producer 侧测试直接校验真实路由响应，不是校验手写夹具 |
| 旧客户端遇到新字段 | 全为附加字段；`bytes-for-byte` 约束写进 delta 的 No-parameters 场景 |
