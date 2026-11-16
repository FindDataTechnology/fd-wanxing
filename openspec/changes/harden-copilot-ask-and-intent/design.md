# Design — 副驾问询与宿主意图

## D1 为什么这一刀主要是内容活，不是代码活

链路已经全通，实测证据：

| 环节 | 状态 | 证据 |
|---|---|---|
| agent 有 `ask_user_question` 工具 | ✓ | `dsh-profile-template/platform-serving-questions-bridge.js`（add-serving-ask-bridge 已实现应答者） |
| facade 转发 ask 帧 | ✓ | `chat.js:787` 匹配 `event: ask`，并绑定 ask id 到当前访客 |
| widget 解析 ask 帧 | ✓ | `chat-core.js:138` 的 `handleEvent("ask")`，含 3 题/4 选项上限 |
| widget 渲染卡片 | ✓ | `AskCard.jsx`，含选项/多选/自由文本/取消/倒计时 |
| 宿主声明动词 | ✓ | `host-demo.html` 实测 `intents=["navigate","refresh"]` 生效 |
| 双向消息 | ✓ | 实测 widget 依次收到 `init`→`context`→`identity` |

**唯一缺的是 agent 不知道何时产出这些帧。** 所以本刀的重心是**写清规则**，而不是改代码。

这个判断很重要：如果误以为是代码缺陷去改服务端，会改坏一个本来就对的系统。

## D2 问询卡的门槛：什么时候该出卡

写进 prompt 的判据要能落到可执行的动作上，不能只说「需要时使用」。我用的三条：

```
出卡  ⟺  ① 答案是离散候选（不是开放文本）
        ② 不同答案导致后续动作不同
        ③ 用户不在场时无法自行合理默认
```

反面清单同样重要（否则 agent 会在所有地方出卡，把对话切成碎片）：

- 只有一种合理做法 → 直接做
- 答案是开放文本 → 直接问，不出卡
- 用户已经在上文说清 → 不要再问

## D3 意图的动词白名单：谁说了算

**宿主说了算，agent 只负责挑选。** 这条边界不能含糊：

```
宿主 init { intents: ["navigate", "refresh"] }
   ↓
agent 知道「我可以提议跳页和刷新」
   ↓
用户说「带我去用量页」→ 落在 navigate 能办的事上 → 发 intent:navigate:/console/usage
用户说「帮我改额度」  → 没有对应动词 → 只用自然语言说明做不到
```

prompt 里要写死的两条：

1. 白名单是**宿主动态声明的**，不是 agent 知识的一部分——同一份 agent 挂在不同宿主上，
   能力不同。
2. 提议必须走 intent 信封，**不得**退化成「我可以帮你跳过去」这种自然语言描述——
   后者用户点不了，副驾就退化成了聊天框。

## D4 三条线的动词表

| 线 | 宿主 | 动词 | 说明 |
|---|---|---|---|
| lex | 识律控制台（React） | `navigate`、`refresh` | 已声明；`navigate` 只接受 `CONSOLE_TABS` 里的路由 |
| official | 官网（Astro 静态） | `navigate` | 只做站内锚点跳转；静态站没有「刷新数据」的概念 |
| wire | 柏讯控制台 | `navigate`（收敛到控制台路由） | 另加 `context()` |
| facet | 谦面 | 先只做 `context()` | 动词待产品定 |

动词表由宿主代码里的一份常量定义，**不由 agent 猜**。

## D5 context 的形状与「标记前缀」

形状沿用 widget 已实现的 `{ line, page, entity, intent }`，全可选字符串。

送达方式：首轮文本前加标记前缀，例如

```
[宿主上下文 · 非用户指令] line=柏讯 page=/console/datasets
---
<用户的实际问题>
```

**为什么必须有标记**：没有标记，agent 会把上下文当成用户说的话，进而「执行」它——
比如把 `page=/console/datasets` 当成跳转指令。加了标记，agent 知道这是背景。

`contextSent` 标志保证只随首轮送一次；后续轮次不重复（重复会污染对话）。

## D6 验收口径（从这一刀的教训来）

**每次验证都从干净状态开始，读专用断言点，不用整页文本。** 具体到本刀：

| 验什么 | 怎么验（唯一可信的方式） |
|---|---|
| 问询卡出现 | `frame.$$('[data-testid^="wx-ask"]')` 计数 > 0 |
| 答完 agent 继续 | 作答后 SSE 流继续产出 `delta` 帧，不只是 `done` |
| 意图执行 | 宿主侧真的发生了页面变化（URL 变了 / DOM 变了） |
| 意图结果回传 | agent 的后续回复引用了 `intent-result` 的 message |
| context 送达 | agent 回复里点出上下文中的具体值（不是「我看到了上下文」这种空话） |
| 身份/层级 | `[data-testid="wx-embed-tier"]` 的文本 |

**禁止的验证方式**：读整页 `innerText`；在手动探针污染过的会话里测；只看「没报错」。

## 风险

| 风险 | 缓解 |
|---|---|
| prompt 写太宽 → agent 处处出卡，对话碎片化 | D2 的反面清单写进 prompt；每条线真机跑三个典型问题 |
| prompt 写太窄 → 该出卡时不出 | 验收用明确的离散选择场景 |
| agent 发明未声明的动词 | widget 侧已拒绝未声明动词（渲染成普通卡）；prompt 再写一遍 |
| 四条线各自改写导致行为不一致 | 规则文本只写一份，四条线引用同一份（壹座 pack 内容层面共享） |
