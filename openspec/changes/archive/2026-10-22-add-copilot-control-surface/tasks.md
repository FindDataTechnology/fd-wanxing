# Tasks: add-copilot-control-surface

> 前置：paas 姊妹 change `add-serving-ask-bridge`（runner 侧 provider + `ask` 事件 + `/ask-answer`）。§1–§3 模块级任务不依赖它；§5 真机验收必须等其 serving 镜像滚产。

## 1. facade：问询接力与答题侧路由

- [x] 1.1 `chat.js` 流式回合：`forwardHeaders()` 之上加 `X-Serving-Ask: 1`（仅 `message/stream`，`message/send` 不加）；转发循环在 `res.write(frame)` 之余解析 `event: ask` 帧的 `data:`，写入 `asks` 内存表 `{askId → {visitorSub, slug, agentPath, deadlineAt}}`，按 `deadlineAt` 驱逐——单测（`test-wanxing-embed.mjs` 假上游吐 `ask` 帧 + 注释帧）：帧逐字节透传、表项写入、注释帧不影响 outcome、`message/send` 无 opt-in 头
- [x] 1.2 `POST /api/wanxing/v1/chat/:agentSlug/ask-answer`：`verifyVisitor` 同闸 + 匿名跨 slug 401 + chat RPM 共享；body `{askId, answers}` | `{askId, cancelled:true}` 形状校验（400）；归属三校验失败 → 404 `ASK_UNKNOWN`；通过后 `upstreamFetch(agentUrlFor(agentPath) + "/ask-answer")` 带后端凭据，回执原样返回；**不记账不占槽**——单测：同访客答通并透传 `{accepted:true}`、他访客 404、未知/过期 404、上游 `{accepted:false}` 原样、无 bearer 401、无新 usage 行
- [x] 1.3 `embed-config` 增 `features: { asks: true }`——单测断言字段存在；`chat.js` 导出表访问器供测试（或经路由间接断言）

## 2. widget：问询卡与意图

- [x] 2.1 `EmbedView.jsx` SSE 解析：跟踪 `event:` 行、按事件名分派（`delta/message` 走现有 `textOfFrame`，`ask` 入 pending 态，`error/done` 现状）；注释行与空行跳过；流在 ask 期间保持读取
- [x] 2.2 `AskCard` 组件（EmbedView 内或 `views/embed/AskCard.jsx`）：questions 渲染（header/detail/options 单选或 `multiSelect`、自由文本、取消）、`deadlineAt` 倒计时、提交后转「已答/已取消/已被先答」摘要态；pending 期间锁 composer；历史持久化只存摘要（`role:"ask"` 行含 questions + outcome），回放只渲染摘要
- [x] 2.3 答题客户端：`embed-auth.js` 增 `answerAsk(slug, bearer, {askId, answers|cancelled})` → `POST …/ask-answer`；复用 `resolveBearer` 梯与一次 401 静默重试；404 `ASK_UNKNOWN` → 卡片提示「该问题已失效，请重发」；本地到期点 `deadlineAt − 5s` 自动 cancel
- [x] 2.4 意图：解析 `intent:<verb>:<arg>` 的 question id；`wx-copilot-init` 读取 `intents?: string[]` 存 `hostIntentsRef`；intent 问询渲染为确认卡（第一个选项 = 执行）；点击执行 → `postMessage({type:"wx-copilot-intent", askId, questionId, verb, arg})` 仅发可信 origin → 等 `wx-copilot-intent-result` ≤ 8s → 以选中标签答题，失败/超时在 `custom` 附原因；非第一选项/取消 → 直接答题不发意图；未声明动词或无宿主 → 卡片标「当前页面不支持此操作」，答案 custom 写明
- [x] 2.5 `vite build` 绿；FleetView「嵌入」面板的 iframe 片段说明增一行「宿主可在 init 声明 intents（如 navigate/refresh）」

## 3. 识律宿主执行器（fd-lex）

- [x] 3.1 `WanxingCopilot.tsx`：init 增 `intents: ["navigate", "refresh"]`；监听 `wx-copilot-intent`（只认 `WANXING_ORIGIN`）：`navigate` arg ∈ `CONSOLE_TABS.map(t => t.to)` → `useNavigate()`；`refresh` → 当前路由数据重拉；其余 → `ok:false, message:"not allowed"`；回 `wx-copilot-intent-result {askId, questionId, ok, message?}`
- [x] 3.2 `WanxingCopilot.test.tsx`（vitest，同目录风格）：声明随 init 发出；合法 navigate 触发路由；`/admin`、带查询串、未知动词均拒；异源消息忽略
- [x] 3.3 fd-lex web 出片（sha-289851b 滚产，公网 bundle 含 wx-copilot-intent；slug 仍为演示 agent）

## 4. 识律正式 copilot pack

- [x] 4.1 部署前核实：用 ops 凭据读 `pack-demo-fingpt` 部署的 `effective_model`（实证可用的 LLM 链）；记录到本 change 的 `measurements.md`
- [x] 4.2 铸包（facet-pack-builder 技能）：persona「识律控制台伴随助手」；skills：`console-tour`（五页各管什么）/ `quota-billing`（配额与账单口径解读，不编造数字）/ `credentials-guide`（凭据创建与轮换流程）/ `intent-protocol`（`intent:navigate:<path>` 与 `intent:refresh:` 用法、选项固定 `["执行","跳过"]`、一次一题、能不问不问、宿主拒绝时的改口）；无 MCP 引用；`suggestedConfig: { budgetMinutes: 8, model: <4.1 核实值> }`
- [x] 4.3 `POST /api/packs/validate` 预校验绿 → 上架 → 舰队部署 → embed-settings ——packId XfyXvzONQFelnFIgM0dJVw v1；计费键=aloadtree 词元账户（OIDC 面板铸 key + admin 充 50，用户原键无属主被拒）；slug packs-xfyxvzonqfelnfigm0djvw-lex-console-copilot；首回合+问询探针全过（measurements 追记）
- [x] 4.4 curl 级探针（在 fingpt 上完成等价验收——新 pack 部署留用户计费键）：非 opt-in 拒答原文、ask 帧信封（模型自行组成 intent:navigate:/console/usage）、facade ask-answer accepted、答案真实回到模型（复述「执行」）、deadline 自取消与收尾；全记录 measurements.md

## 5. 出片、真机验收、切换、归档

- [x] 5.1 萬星 facade+web 双镜像出片（`fd-build-channel` 判路；源仓先推 origin 再 `fd-build-snapshot`，多镜像串行）；无新 env；pod 内 grep 新路由实证
- [x] 5.2 ego 真机四线（SafeLine 修复后 2026-10-22 全过，等价 harness 宿主，详 measurements）：① 问询往返（卡片→答题→回合收尾，账本一行、无新 usage 行）；② 识律控制台 navigate 意图往返（点「执行」→ 页面切到用量页 → agent 收到确认）；③ 到期自动取消（短预算部署或等 deadline，agent 正常收尾）；④ 独立打开 `#/embed`（无宿主）intent 卡显示「不支持」并如实答题
- [x] 5.3 切换 `WIDGET_SLUG` → fd-lex web sha-84724f2 滚产（真机复跑 ② 随 5.2 待入口修复）
- [x] 5.4 `docs/adr/0004-host-intents-ride-question-ids.md`；`CONTEXT.md` 增「问询卡」「宿主意图」词条并标注 `#/chat` 页暂不渲染问询；spec 同步（`openspec validate --specs`）；归档
