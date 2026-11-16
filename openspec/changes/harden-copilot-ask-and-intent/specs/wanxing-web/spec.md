## ADDED Requirements

### Requirement: 副驾 agent 在需要用户拍板时产出问询卡

部署为某条线副驾的 agent SHALL 在「用户的答案会改变后续动作、且候选是若干离散选项」时，
经 `ask_user_question` 产出问询帧，而不是把问题写进正文让用户自由回复。

问询 SHALL 携带足够上下文，使用户无需回翻上文即可作答。一次回合最多 3 个问题、每个问题
最多 4 个选项（与前端 `parseTurnStream` 的解析上限一致；超出部分会被静默丢弃）。

当只有一种合理做法、或答案是开放文本时，agent SHALL NOT 产出问询卡，直接执行或直接提问。

#### Scenario: 离散选择产卡，答完 agent 继续

- **WHEN** 用户的要求存在多个可行且互斥的选项（例如「用哪个数据集」「按哪条口径算」）
- **THEN** agent 产出一张问询卡，选项即那些候选；用户作答后该回合继续推进，而不是结束

#### Scenario: 开放问题不产卡

- **WHEN** 用户问的是开放文本（例如「介绍一下柏讯」）
- **THEN** agent 直接作答，不产出问询帧

#### Scenario: 超出解析上限不静默降级

- **WHEN** agent 一次产出超过 3 个问题或单问题超过 4 个选项
- **THEN** 前端保留前 3 题 / 每题前 4 项，其余丢弃；agent 端 SHALL 以不超过该上限的方式提问

### Requirement: 宿主意图只能由宿主声明的动词发起

宿主在 loader 的 init 握手里声明它可执行的动词白名单（例如 `navigate`、`refresh`）。
副驾 agent SHALL 仅在「用户的要求恰好落在某个已声明动词能办的事上」时，以
`intent:<verb>:<arg>` 形式的问询表达提议——**不得**把同一提议写成自然语言句子。

agent SHALL NOT 发明宿主未声明的动词。宿主未声明某个动词时，agent 对该类请求只能作
自然语言说明，不得产出可执行提议。

用户未点击提议时，宿主 SHALL NOT 执行任何页面动作。

#### Scenario: 用户要跳页，agent 发 intent 而非描述

- **WHEN** 宿主已声明 `navigate`，用户说「带我去看用量页面」
- **THEN** agent 产出 `intent:navigate:<path>` 形式的问询，卡片渲染出可执行选项；
  用户点选后宿主执行跳转，并把结果回传给 agent

#### Scenario: 未声明的动词不出现可执行选项

- **WHEN** 宿主只声明了 `navigate`，用户要求「帮我刷新这一页」
- **THEN** agent 只用自然语言说明宿主不支持该动作，不产出任何可执行提议

#### Scenario: 只提议不动作

- **WHEN** agent 已产出某个意图提议但用户没有点选
- **THEN** 宿主页面不发生任何变化

### Requirement: 宿主上下文的形状与首轮递送语义

宿主 SHALL 经 `context()` 钩子提供页面上下文，形状为
`{ line?: string, page?: string, entity?: string, intent?: string }`，各字段为可选字符串。

上下文 SHALL 作为**宿主提供的数据**、以标记前缀的形式随首轮送达 agent，与用户指令可区分；
agent SHALL 把它当作背景信息理解，SHALL NOT 把它当作用户的新指令执行。

SPA 路由变化时宿主 SHALL 推送刷新后的上下文；刷新后的上下文随下一轮生效。

#### Scenario: 首轮携带标记前缀

- **WHEN** 宿主在 init 后提供了 `{ line: "柏讯", page: "/console/datasets" }`
- **THEN** 该回合送达 agent 的首轮文本带有可识别的上下文前缀，agent 的回复体现出它读到了这些信息

#### Scenario: 路由变化刷新上下文

- **WHEN** 用户在宿主 SPA 内导航到另一个页面
- **THEN** 宿主推送新的上下文，widget 的上下文栏随之更新，下一轮携带新值

#### Scenario: 无上下文的宿主照常可用

- **WHEN** 宿主不提供 `context()` 钩子
- **THEN** 副驾按绑定允许的访客层级正常工作，不产生错误也不渲染空的上下文栏
