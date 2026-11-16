## ADDED Requirements

### Requirement: Every product line with a public surface carries a resolvable copilot

每一条对外有页面的产品线 SHALL 在萬星平面里有一个可解析的副驾绑定，使该线页面能以 loader 一行接入
得到可对话的助手。未绑定、绑定已失效、或绑定指向不可服务的 agent，SHALL 表现为**可见的治理缺口**：
控制台的线副驾面板 SHALL 列出该线并标明其状态，而不是让该线在面板中静默缺席。

绑定、解析、准入的语义 SHALL 沿用既有要求（绑定只是意图；访客准入仍走两道闸），本条不改变它们，
只要求**覆盖面**：有页面的线不得长期停留在未绑定状态。

#### Scenario: An unbound line is a visible gap, not a silence

- **WHEN** 一条对外有页面的产品线没有绑定
- **THEN** 控制台的线副驾面板列出该线并标注未绑定，运营者无需靠记忆知道它缺

#### Scenario: A bound line resolves to a mountable copilot

- **WHEN** 一条线绑定到一个公开、可对话、未暂停的 agent
- **THEN** 该线的公开解析端点回答 ready，且该线页面用 loader 一行即可挂出可对话 widget

#### Scenario: A closed binding leaves no dead card

- **WHEN** 一条线的绑定指向已暂停、已转私有、或已从台账消失的 agent
- **THEN** 解析回答 closed 并给出原因，宿主页面不留死卡（loader 不注入）

### Requirement: Host pages mount the copilot through the loader, not hand-written protocol

宿主页 SHALL 经 loader 标签接入副驾，SHALL NOT 自行编写 postMessage 协议代码。宿主可按需提供
身份、上下文、意图三类可选钩子；不提供任何钩子的宿主 SHALL 仍得到可用的 widget（按其绑定允许的
访客层级）。

已存在的手写宿主封装 SHALL 在接入时回收为 loader + 钩子；回收后宿主的身份递送行为 SHALL 保持不变。

#### Scenario: Zero-protocol mount

- **WHEN** 一个宿主页面只放入 loader 标签（带 `data-line`）且不提供任何钩子
- **THEN** 副驾按该线绑定允许的访客层级挂出并可对话，宿主侧没有 postMessage 代码

#### Scenario: Host identity survives the migration

- **WHEN** 一个原本手写协议、经自己的身份系统递送租户票的宿主改为 loader + 身份钩子
- **THEN** 其每轮递送的身份票行为与迁移前一致，widget 优先使用宿主票而非匿名层级

#### Scenario: Context and intents are optional

- **WHEN** 宿主只提供上下文钩子而不提供意图钩子
- **THEN** 上下文随首轮递达并显示在 widget 里，问询卡正常出现，宿主意图不出现在选项中
