# 萬星域内关联收口（close-wanxing-domain-linkage）

## Why

萬星把自己对兄弟线的依赖写成了契约（`wanxing-borrowed-contracts`：四条出向边界），但**入向是裸的**：七个消费者在钉住萬星公开面的形状，却不在任何 spec 里，也没有一处测试会在字段改名时变红。已扫全工作区（五条产品线 + 运维 MCP + 数据工厂）：谦面脊柱、壹座主人跨线、壹座 ops-console、识律副驾 loader、柏讯 A2A 直连、萬星运维 MCP、数据工厂工单链。

**这不是理论风险，已经炸过一次。** `fd-industry-data/config/alert-selfcheck-known.json:5`：工单链的 a2a 路由从平台搬到萬星门面后，spider-heal 不在门面的 18 个 public agent 里，原 slug 直接 `404 AGENT_NOT_FOUND`（2026-11-08 实测），整条投递链静默死亡，处置只是「记成已知不修」。搬迁方不知道谁在调，调用方不知道该找谁——这就是没有入向契约的代价。

更硬的一处是契约要求已经写死、填的人却是空的：`paas/openspec/specs/supply-catalog/spec.md` 要求「Live instance status reported by the serving plane SHALL be included when present」，而 facade 的目录行**根本没有 status 字段**（`services/wanxing-facade/a2a.js` 的 entry 组装逐字段读过）。于是 `paas/facet/supply-catalog.js:199` 的 `a.status ?? "unknown"` 永远是 unknown，静态门厅（`paas/scripts/plaza-export.mjs:190`）与它的测试夹具都指向同一个从未被履行的义务 —— 供给域 D1「萬星实例真源入脊柱（带状态/出处）」只落地了出处，没落地状态。

**而且同一份 facade 里两个面已经在互相打脸。** 目录把 chatability 传给门禁时写死了 `paused: false`（`services/wanxing-facade/a2a.js:534`），而门禁本身要求 `!state.paused`（`chat.js:173-175`）。于是**一个已暂停的公开 agent 在目录里被标成「可对话」**，而同一台 facade 的 `/chat/:slug/status`（走 `agentState`，暂停态是真的）会回答 `chatAble: false, reason: "agent_paused"`。目录把这个标记一路传下去：萬星 web 的卡片据此给「进入对话」入口，谦面脊柱复制给门厅（`supply-catalog.js:200`）。访客点进去，得到 423。这是「状态没有唯一来源」的直接后果，本 change 顺手把它修掉。

**精度说明（2026-11-13 线上实测，避免误判）**：这条矛盾目前是**潜伏**的，不是正在出错——`GET /api/wanxing/v1/agents` 返回 18 个公开条目、**0 个带 `status` 字段**；18/18 都是 `chatable: true`，而 `/chat/:slug/status` 对同样 18 个的回答也全是 `chatAble: true`（`subsidy: "on"`，且当前没有暂停中的 agent）。所以两个面现在恰好一致。**只要任一 agent 被暂停、或平台补贴关掉而某 agent 无主人池，两面就会给出相反答案。** 代码缺陷是确定的（写死的 `paused: false`），现形条件是外部的。

还有一处同名不同命的重复：暂停/恢复的真相是 registry 的 `metadata.paused`，但写它的逻辑有两份——门面 `console.js:36` 的注释自认是 `paas/lib/agent-serving.js:434` 的「minimal copy, keep in lockstep until ②-收敛」，至今未收敛。读路径的漂移会查得到，**写路径的漂移是两个门都还能用，只是某天开始行为不同**。这一处归姊妹 change `unify-wanxing-shared-semantics` 处置，此处只登记。

同时第五条借用边界漏登记：`services/wanxing-facade/selfservice.js:31` 的 `FACET_BASE_URL`/`FACET_INTERNAL_TOKEN` 以转发身份直调谦面 packs 面，这是与 registry/packs/sub2api/runner 同级的一条借用依赖，spec 的四条清单里没有它。

## What Changes

**① 入向消费者登记为契约的一部分**
- 五个消费者（谦面 supply-catalog、壹座主人跨线 `fleets.js`、壹座 ops-console fleet board、识律副驾 loader、柏讯 A2A 直连）各自钉住的字段，写进 `wanxing-borrowed-contracts`，成为契约的产品面。
- 浏览器接入面（`copilot.js` + `wx-copilot-*` 协议）同列契约：宿主必须以配置/声明给出接入地址，源码内写死萬星域名是缺陷（识律今天就是这样：`fd-lex/web/src/console/WanxingCopilot.tsx:16`）；失效时必须可见，不得伪装成「页面右下角什么都没有」。
- 新增契约修订号（`x-contract-rev`）：任一被消费字段的形状变化必须升号，并在 producer/consumer 两侧各有一条形状校验；跨仓漂移由根层检查脚本对账。
- 参照标准不是新造的：柏讯 `fd_wire_api/demands/wanxing.py` 已经是正确形态（4 个 env + 缺省、生产探针冻结形状、键值不入日志、幂等键按内容派生），把它写成要求即可。

**② 目录行补「实例状态 + 出处」，并让 chatability 用真实的暂停态**
- `GET /api/wanxing/v1/agents` 每个条目新增从既有事实派生、绝不臆测健康的 `status`（`serving` / `idle` / `paused` / `unknown`）与 `status_as_of`。
- 派生规则只用 facade 已有的两个事实：部署行的 `paused` 与自家账本的 `turns7d`（七日零回合 = `idle`，不是健康；部署源降级 = `unknown`，不默认健康）。
- **修掉 chatability 写死 `paused: false` 的缺陷**：目录标记必须与 chat 车道的准入判断一致，暂停的 agent 不得被标成可对话。
- 谦面脊柱与门厅因此第一次能填上它们已经要求的字段（`supply-catalog.js:199` / `plaza-export.mjs:190` 的既有 `?? "unknown"` 兜底不变，只是不再是唯一结果）。

**③ 第五条借用边界入册**
- `FACET_BASE_URL` / `FACET_INTERNAL_TOKEN`（部署者自助：以转发身份调用谦面 packs 面）提升为登记在案的第五条款，与其余四款同列，一并进「变量编址一处可发现」清单。

**④ 冻结「标签 vs 准入」的不对称**
- 核查确认：`category`/`featured` 只有一份存储源（`packs` 表的两个列，`gateway/packs.js:81-82`），市场形态的面都经 `loadListedPacks`（`facet/marketplace-json.js:35`「The ONE listing rule」）**拿它当准入过滤器**（curated ∨ 运营白名单 `FACET_MARKETPLACE_PACK_IDS`，白名单替换而非取交集）。
- 萬星目录必须**拿它当标签**：已部署且公开的 agent，即使从未被策展，也照常入列；运营把白名单收窄到 3 个包，萬星目录不能跟着只剩 3 条。
- 本 change 因此不改数据源（无需新端点），而是把这个不对称写成要求并给出可证伪的验收：未策展的部署仍在列、白名单不影响本目录、门面不自创策展（不从名字/标签/徽章猜）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-borrowed-contracts`：新增「入向消费者同属契约」「浏览器接入面同属契约」「谦面 packs 面为第五条借用边界」「契约修订号与跨仓一致性夹具」四项要求；扩写既有「借用依赖可发现且 env 双名兼容」，把四条边界扩到五条并规定按组件族列名（facade 与 observer 对同一上游用不同变量族这件事必须写在表里）。
- `wanxing-facade`：新增「目录行携带实例状态与出处」；扩写「目录的策展与活跃信号」，把策展的角色从「过滤器的同款」明确为「标签」——规定不得套用市场准入规则（策展过滤、运营白名单），并规定状态字段的诚实派生规则与降级语义。
- `wanxing-web`：扩写「公共目录页列出 agent」，加实例状态徽标与「已部署实例视图」定位，且状态未知时显式呈现未知（不得渲染成在线）。

## Non-goals

- **不建写侧推送**：供给域文档写的「萬星→脊柱 回报」不落成 facade 主动推送。脊柱已有 TTL 轮询 + honest-absence 语义，读侧投影零新凭据、零新入站门；反向推送要新开 ingest 端点与新失败模式。此偏离在 design 里显式记录。
- **不做实现层重构**：env 表与 `slugFor` 单源是姊妹 change `unify-wanxing-shared-semantics` 的范围，本 change 只到契约层。
- 不改 A2A 协议、计费口径、身份阶梯、准入规则。
- 不删除 paas 死替身（`paas/gateway/wanxing/`）——那是 `paas` 仓 `retire-wanxing-twin-face` 的范围。
- 不引入新的健康判定：状态只做既有事实的投影，不加入心跳推断、不接 observer health 做第二判据。

## Impact

**代码（fd-wanxing）**
- `services/wanxing-facade/a2a.js`：目录 entry 组装增 `status` / `status_as_of`；策展 join 保持既有读面（唯一存储源），仅补注释声明「标签非准入」。
- `services/wanxing-facade/routes.js`：策展标签的读取点加注「这是标签不是准入」，并保证不读 `FACET_MARKETPLACE_PACK_IDS`（保留既有超时与降级纪律）；第五条款的 env 读取归口到既有 seam。
- `contracts/`（新）：`wanxing-public-api.v1.json`（被消费形状的机器可读契约，带 `x-contract-rev`）。
- `wanxing-web/src/views/CatalogView.jsx`：状态徽标 + 未知态显式呈现。
- `scripts/`：目录契约的 producer 侧形状校验测试。

**契约与兄弟仓**
- `paas/facet/supply-catalog.js`：策展/状态消费侧形状校验（由 paas 仓 change `retire-wanxing-twin-face` 的任务承接，此处只交叉引用）。
- 根层漂移检查脚本（`finddata/scripts/`，跨仓对账；不属任何单仓 CI 的必过项）。

**部署**
- 无新增 env、无 manifest 变更；`FACET_BASE_URL` / `FACET_INTERNAL_TOKEN` 若已配置则行为不变，未配置仍是显式 503。
