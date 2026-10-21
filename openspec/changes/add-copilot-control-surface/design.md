## Context

见 proposal.md。地基已核实：

- **seam 约束是硬的**。dsh `ask_user_question` 的 seam 侧 question schema 为 strict（`id/question/header?/detail?/options?/multiSelect?`），option 只有 `label/description`、无 id，未知字段在 seam 被 transform 丢弃；模型可控的字段里只有 question `id` 是自由字符串。问询答案形状是 `{answers:[{id, selected:[label…], custom?}]}` 或 `{cancelled:true}`（壹座 `QuestionCard.tsx` 同款）。
- **runner 新面（姊妹 change）**：流上 `event: ask` `{askId, sessionId, questions, deadlineAt}`，`POST /ask-answer`（后端凭据同闸）回 `{accepted}`，opt-in 头 `X-Serving-Ask: 1`，问询期间每 15s 一条 SSE 注释帧，到期 runner 自行取消。
- **facade 今天**：`chat.js` 流式回合 `upstreamFetch(config.agentUrlFor(state.agentPath))` 后逐字节 `res.write(frame)`，仅正则扫 `event: error` 记 outcome；`verifyVisitor` 是唯一身份切口；chat RPM/槽/幂等/记账全按 `visitorSub` 参数化。
- **widget 今天**：`EmbedView.jsx` 按行解析、只看 `data:` 行、`textOfFrame` 取 parts 文本；回合在流关闭时结束；凭据梯在 `embed-auth.js resolveBearer`；宿主消息监听已锁定可信 origin（首个 init/context 来源）。
- **识律宿主**：`WanxingCopilot.tsx` 固定右下 iframe，`wx-copilot-ready` 后发 init、按需回 `wx-copilot-identity`、推 `wx-copilot-context`；控制台只有 `CONSOLE_TABS` 五个路由 + `/admin`。
- **LLM 链**：serving 面多数部署 child→LLM 403/502（独立事故），`pack-demo-fingpt` 实证可用；部署可按 pack `suggestedConfig.budgetMinutes`（1–120）设回合预算。

## Goals / Non-Goals

**Goals：**

- agent 能在回合中问人、人能在 widget 里答，流不断、回合正常收尾、记账不变。
- agent 能提出页面动作，**只在用户点击后由宿主执行**，结果回到 agent；宿主侧零信任（白名单 + 可信 origin）。
- 识律控制台成为首个宿主执行器，并挂上正式的识律 copilot pack。
- 对不支持问询/意图的宿主或独立打开的 `#/embed` 页，行为退化为「如实告知不支持」，不出错不挂起。

**Non-Goals：**

- `#/chat` 页的问询卡；识律 highlight/prefill 动词；识律账户数据读取工具（无 MCP 服务面）；暂停或延长回合预算；匿名访客的写动词（v1 无写动词）。

## Decisions

**D1 — 问询归属记在 facade 内存，由转发时解析 `ask` 帧铸成。**
runner 不知道访客是谁，答题归属必须在 facade 做。转发循环已经逐帧扫 `event: error`，顺手解析 `event: ask` 的 `data:` 取 `askId/deadlineAt`，写 `asks: Map<askId, {visitorSub, agentPath, slug, deadlineAt}>`，到期自动驱逐。答题路由三重校验（存在、同访客、同 agent）后才代理。*不落库*：问询生命周期以分钟计，facade 重启丢表的后果只是「该题答不了 → widget 收 404 → 提示重发」，runner 侧到期自取消兜底。*否决*：把归属塞进 askId（runner 铸 id，facade 无从参与）；或让 widget 直打 runner（暴露后端凭据，违反 E1 的「facade 是唯一出口」）。

**D2 — 意图信封 = question id 前缀 `intent:<verb>:<arg>`，确认 = 问询本身。**
seam 丢一切非法字段、option 无 id，question `id` 是唯一能承载结构的模型可控字段，且原样回到答案里（`answers[].id`），agent 天然知道自己问的是哪条意图。语法：`verb` 为 `[a-z-]+`，`arg` 为其后全部字符（可含 `/` 与 `:`）。「写操作强制确认」由形态保证：意图必经问询卡、必经用户点击。*约定*：intent 问询的**第一个选项即执行**（pack 技能里固定写 `["执行", "跳过"]`），widget 不猜测标签语义。*否决*：解析 option label 前缀（label 是给人看的，污染对话）；在 `detail` 里塞 JSON（可读性差且同样是文本约定，不比 id 更可靠）。

**D3 — 宿主能力在 init 里声明，widget 永不自行执行。**
`wx-copilot-init` 增 `intents?: string[]`；widget 只把声明过的动词渲染为可执行，其余标「当前页面不支持此操作」并如实答题，agent 据此换一种说法。意图消息只发往已锁定的可信 origin；`wx-copilot-intent-result {askId, questionId, ok, message?}` 回来后才答题，宿主 8s 不回视为失败（答案 custom 写「宿主未响应」）。宿主执行的是它自己页面上的动作，界面刷新由宿主执行本身完成——「动作做了界面不动」在这个形态下不存在。

**D4 — 识律白名单只做 `navigate`（五路由）与 `refresh`。**
`navigate` 的 arg 必须精确等于 `CONSOLE_TABS[].to` 之一（不接受 `/admin`、不接受查询串）；`refresh` 走现有页面数据重拉（router 的 `navigate(0)` 或页面级 refetch）。任何其他动词/路径回 `ok:false, message:"not allowed"`。匿名访客与登录访客同白名单——两动词都只影响访客自己浏览器里的页面，无服务端副作用。

**D5 — 到期由 widget 先取消、runner 再兜底。**
widget 以 `deadlineAt − 5s` 为本地取消点（POST cancelled），runner 的到期自取消是第二道；两次取消的第二次只会得到 `{accepted:false}`，无副作用。倒计时显示在卡片上，让访客知道这不是永久等待。

**D6 — 正式 pack 走既有铸包链，v1 无工具、钉可用模型、预算 8 分钟。**
persona + 四个 skills（导览 / 配额账单解读 / 凭据指引 / 意图使用规范），不带 MCP 引用——识律没有服务面可挂，装上写工具只会让 agent 幻觉它能改账户。`suggestedConfig.budgetMinutes: 8` 覆盖人答一两道题；模型钉到 `pack-demo-fingpt` 部署当前生效的那条（部署前用 ops 读其 `effective_model` 核实，不硬编码进 pack）。铸包用 facet-pack-builder 技能，`/api/packs/validate` 预校验，上架后在萬星舰队部署，再开 embed-settings（匿名 + 识律来源）。

**D7 — 切换 `WIDGET_SLUG` 是最后一步，且有真机门槛。**
新 agent 必须先在 ego 真浏览器上过「首回合有输出 + 一次问询往返 + 一次 navigate 意图往返」，再改 `WanxingCopilot.tsx` 出片；切换前识律线上一直是演示 agent，可随时回退（改回 slug 即可）。

**D8 — 上线顺序与门槛。**
① paas 姊妹 change serving 镜像先滚（否则 ask 仍是 NO_PROVIDER）；② 萬星 facade+web 同车出片（facade 无新 env）；③ 识律 web 出片（执行器 + 声明）；④ pack 上架部署 + 真机四线；⑤ 切 slug 再出一次识律 web。模块级（facade 测试、vite build、fd-lex vitest）不依赖 ①，可先做。

## Risks / Trade-offs

- [姊妹 change 未滚产] → 模块级任务不受阻；真机任务显式标注前置；widget 对无 `ask` 帧的流零变化。
- [facade 重启丢问询归属] → 答不了的题 widget 显示「请重发」，runner 到期自取消；可接受，不落库。
- [宿主上下文注入「intent:」形状文本] → 上下文仍是前缀数据、不进 question id；意图只来自 `ask` 帧，执行只由用户点击 + 宿主白名单触发。
- [匿名访客触发 navigate] → 只影响其自身页面，无服务端副作用；写动词未来必须加 tier 门（记入 ADR）。
- [新 agent LLM 链不通] → D6 钉模型 + D7 真机门槛；不通则识律继续挂演示 agent，不切 slug。
- [一个回合里多次问询] → 协议天然支持（每次新 askId）；预算 8 分钟是总上限，技能里写明「一次最多问一题，能不问就不问」。
- [`#/chat` 页收到 ask 帧] → 其解析同样只看 `data:` 行，ask 帧被忽略、流保持到 runner 到期取消；本 change 不动它，但在 CONTEXT.md 标注该限制（后续 change）。
