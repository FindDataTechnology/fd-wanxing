# 副驾操控面（E3）+ 识律正式 copilot pack

## Why

`add-embed-copilot-lane`（2026-10-21 归档）把萬星对话车道做成了可跨站嵌入的 widget，并补齐身份阶梯与宿主上下文；它的 proposal 明文把**操控面（E3）**留作第二个 change：`ui_intent` 宿主动作、问询卡经 chat lane 下发与答题路由、runner 侧 user-questions provider 移植。上产后的真机走查把三个缺口坐实：

1. **agent 问不了人**。served child 的 `ask_user_question` 今天没有应答者（runner 只叠 presets/skills/mcp/notify 四层，user-questions 桥只写进 cell 的家；paas 姊妹 change `add-serving-ask-bridge` 补 provider + 流上 `ask` 事件 + `/ask-answer` 侧路由）。widget 这边即便收到 `ask` 帧也只认 `data:` 行、不看 `event:` 行，问询会静默消失。
2. **agent 动不了页面**。E1 设计刻意让车道「纯对话、无动词」；copilot-surface explore 点名「动作做了界面不动」是操控感断裂第一现场。而 dsh 问询缝是 CopilotKit「客户端动作」的同形缝——宿主执行、用户确认、结果回到 agent，三件事一次走完。
3. **识律挂的是演示 agent**。`fd-lex/web/src/console/WanxingCopilot.tsx` 的 `WIDGET_SLUG` 指向 `pack-demo-fingpt`（唯一 LLM 链通的部署），不是识律的副驾。没有正式 pack，操控面没有「脑」可以验收。

三件事一车：facade 接住姊妹 change 的新面（答题路由 + 访客归属），widget 渲染问询卡并把**意图**交给宿主执行，识律控制台做首个宿主执行器，再以一个正式的识律 copilot pack 作为验收载体并替换 `WIDGET_SLUG`。

## What Changes

- **facade：问询接力 + 答题侧路由**。流式回合向 serving 面发送 opt-in 头（`X-Serving-Ask: 1`）；转发 SSE 时照旧逐字节透传，但顺手解析 `event: ask` 帧，把 `askId → {visitorSub, agentPath, deadlineAt}` 记在内存里；新增 `POST /api/wanxing/v1/chat/:agentSlug/ask-answer`（`verifyVisitor` 同闸、归属校验、chat RPM 共享），代理到该 agent 的 `/ask-answer` 并原样返回 `{accepted}` 回执；`embed-config` 带 `features.asks: true`。
- **widget：问询卡**。SSE 解析改为按 `event:` 分派；`ask` 帧渲染为卡片（选项/多选/自由文本/取消），带 `deadlineAt` 倒计时并在到期前自行取消；回合流保持打开，答题后流继续到 `message`/`done`；历史回放只渲染已解决摘要，不复活卡片；问询期间锁 composer。
- **widget：宿主意图（intent）**。seam 的 question schema 是 strict、option 无 id、未知字段被丢弃——**意图只能骑模型可控的 question `id`**：`intent:<verb>:<arg>`。宿主在 `wx-copilot-init` 里声明支持的动词；widget 把 intent 问询渲染为确认卡，**用户选中第一个选项才执行**：postMessage `wx-copilot-intent` → 宿主执行 → `wx-copilot-intent-result` → widget 以选中标签（失败时在 custom 附失败原因）答题。宿主未声明/无宿主 → 卡片标「当前页面不支持此操作」并如实答题。**没有用户点击，不会有任何页面动作**。
- **识律宿主执行器**。`WanxingCopilot.tsx` 声明 `intents: ["navigate", "refresh"]`，白名单执行：`navigate` 只接受 `CONSOLE_TABS` 的五个路径（`/console`、`/console/credentials`、`/console/usage`、`/console/billing`、`/console/quota`），`refresh` 重拉当前页数据；其余动词/路径一律回 `ok:false`。验收通过后把 `WIDGET_SLUG` 切到识律 copilot 部署。
- **识律正式 copilot pack**。走既有铸包链（谦面工坊 / facet-pack-builder → `/api/packs/validate` → 上架 → 萬星舰队部署）：persona「识律控制台伴随助手」，skills = 控制台导览 / 配额与账单解读 / 凭据管理指引 / 意图使用规范（`intent:` id 约定 + 确认纪律 + 不编造账户数据）；v1 **不带写工具**（识律没有 MCP 服务面，账户数据读取是后续线）。`suggestedConfig.budgetMinutes: 8`（人答题的时间要在回合预算内），模型钉到 `pack-demo-fingpt` 当前在跑的那条（serving 面 child→LLM 403/502 事故独立遗留，只有这条链实证可用）；embed-settings 开匿名（按既有策略）+ 允许识律站点来源。
- **不做**：`#/chat` 主对话页的问询卡（后续）；识律侧 highlight/prefill 动词（协议允许，宿主白名单决定）；识律账户数据读取工具；暂停回合预算；壹座 CopilotDock 收敛。

## Capabilities

### New Capabilities

_无。_

### Modified Capabilities

- `wanxing-facade`：新增「流式回合接力 serving 问询并绑定访客归属」与「问询答题经认证侧路由代理」两条需求；既有「Visitors authenticate…」「Chat traffic is bounded…」不改，新路由复用其闸与限速。
- `wanxing-web`：新增「widget 把在途问询渲染为可答卡片」与「宿主意图骑 question id、仅经用户确认后由宿主执行」两条需求；既有「The embed view carries the copilot widget…」「Host context rides the first turn visibly」不改（上下文仍按不可信数据处理，意图执行只由用户点击触发）。

## Impact

- 代码：`services/wanxing-facade/chat.js`（opt-in 头、ask 帧解析与归属表、`ask-answer` 路由）、`scripts/test-wanxing-embed.mjs`（假上游吐 ask 帧 + 路由测试）；`wanxing-web/src/views/EmbedView.jsx`（事件分派、AskCard、意图握手与消息）、`wanxing-web/src/embed-auth.js`（答题请求复用 bearer 梯）；`fd-lex/web/src/console/WanxingCopilot.tsx`（意图执行器 + 声明 + `WIDGET_SLUG`）+ `WanxingCopilot.test.tsx`。
- 依赖：**paas `add-serving-ask-bridge` 先滚 serving 镜像**，否则 agent 的问询仍是 NO_PROVIDER 工具错误——本 change 的模块级任务不被阻塞，但真机验收（问询往返、意图往返）必须等它上产。两 change spec 面互不相交，归档顺序无约束。
- 部署：萬星 facade+web 双镜像一次出片，无新 env；识律 web 一次出片（切 slug 前后各一次或合并）；新部署一个 agent（舰队 billingKey 既有流程）。
- 文档：`docs/adr/0004-host-intents-ride-question-ids.md`（意图信封选型：seam 约束 → question id 前缀；确认即问询）；`CONTEXT.md` 增「问询卡」「宿主意图」词条。
