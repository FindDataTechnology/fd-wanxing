# 副驾问询与宿主意图打通（harden-copilot-ask-and-intent）

## Why

`spread-line-copilot` 把四条线的副驾接上了，并在过程中修掉一个根本缺陷（握手死锁——
跨线副驾的「宿主身份递送」自设计以来从未生效，四线全跑在匿名层）。修完后的真机状态：

```
官网 寻数分身   匿名对话 ✓
柏讯 柏讯专家   匿名对话 ✓
谦面 谦面专家   登录后对话 ✓
识律 识律副驾   **已登录**，回合请求携带宿主 Logto JWT ✓
```

**但问询卡与宿主意图这两条链路一次都没在真机上走通。** 而它们正是跨线副驾区别于
「一个 iframe 聊天框」的全部价值：

- **问询卡**：agent 在回合中途要用户拍板（选哪个数据集、要不要用这条口径），卡片直接
  出现在对话里，答完 agent 继续。没有它，复杂的多步任务只能靠一次长长的自由文本往返。
- **宿主意图**：agent 提议「我帮你跳到用量页」，用户点一下，**宿主页面真的跳过去**。
  它让副驾从「会说话」变成「能办事」，而且是「你确认我才动」的边界内办事。

接入层与解析链路都已验证完整（`host-demo.html` 的 intents 声明生效、widget 收到
`init`/`context`/`identity`；`chat-core.js` 的 `ask` 帧解析、facade 的 `event: ask`
转发、`platform-serving-questions-bridge.js` 的应答者都已就位）。

**阻塞点只有一个：agent 不知道什么时候该产出这些帧。** 实测让它「用选择题问我」，
它只是把问题写进正文；让它「带我去看用量页」，它口头说明能做到，但没有发出
`intent:navigate:<path>` 信封。工具在手上，规则不在 prompt 里。

## What Changes

**① 让 agent 会用 `ask_user_question`（pack prompt 侧）**

- 逐条线的副驾 agent，在它的 serving 契约/prompt 里写清**何时**该用问询卡：
  需要用户在若干离散选项里拍板、且答案会改变后续动作时；不要在只有一种合理做法时滥用。
- 问询卡的问题描述要带足够上下文，让用户不翻上文也能答。
- 一次最多 3 个问题、每个最多 4 个选项（与 `chat-core.js` 的解析上限一致）。

**② 让 agent 会发宿主意图（pack prompt 侧）**

- 当宿主的 `intents` 白名单里声明了某个动词（例如识律的 `navigate`），且用户的要求
  恰好落在这个动词能办的事上，agent SHALL 发 `intent:<verb>:<arg>` 形式的问询，
  而不是把「我可以帮你跳过去」写成一句话。
- **动词白名单由宿主声明，agent 不得发明**：宿主没声明的动词，agent 只能口头说明。
- 用户点第一个选项才算同意；未点不动作。这条边界由 widget 与宿主共同保证，prompt 只需
  保证「用 intent 信封表达提议，而不是用自然语言描述提议」。

**③ 三条线的宿主侧补齐**

- 识律（lex）：已有 `navigate`/`refresh`，验证真机可用。
- 官网（official）：静态站，补 `navigate`（站内锚点跳转）——这是它唯一有意义的动词。
- 柏讯（wire）：控制台侧补 `context()` 递当前页面/数据集；`intents` 按控制台路由收敛。
- 谦面（facet）：按产品面定，可先只做 `context()`。

**④ wire 控制台的上下文递送（原 `spread-line-copilot` 3.6）**

`context()` 返回 `{ line, page, entity?, intent? }`，随首轮以**标记前缀**送达 agent
（宿主提供的数据，不是用户指令）。

## Non-goals

- 不改 widget 的 ask/intent 渲染与协议——它们已完整实现且有测试覆盖。
- 不改 facade 的 `event: ask` 转发与 `ask-answer` 侧路由。
- 不在本刀做壹座迁移（`CopilotDock` 423 行）：那是 paas 仓的独立刀，等本刀让三线
  四项全过之后再动。
- 不为「让 agent 产出 ask」而改服务端行为——这是内容（prompt）问题，不是代码问题。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-web`：新增「副驾 agent 的问询与意图行为契约」——何时该产出 `ask` 帧、
  何时该发 `intent:<verb>:<arg>`、动词白名单只由宿主声明；宿主侧 `context()` 的
  形状与首轮标记前缀语义。

## Impact

- **pack / prompt 侧（主要工作量）**：四条线副驾 agent 的 serving 契约与 prompt。
  产出点在壹座的 pack 内容，不在萬星代码里。
- **宿主仓（小改）**：`fd-official-web`（补 intent）、`fd-wire`（补 context 钩子）、
  `paas/facet/web`（按需）。
- **wanxing-web**：零或极小改动（若发现 ask 帧的边界 case 才动）。
- 验收：每条线三项真机——问询卡出现且答完 agent 继续、宿主意图执行且结果回到 agent、
  `context()` 的首轮前缀在 agent 回复里被正确读到。
- 前置：`spread-line-copilot` 已归档（握手死锁已修，身份递送已验证），本刀建立在它之上。
