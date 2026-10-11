# mission-definitions Specification

## Purpose

M2 场景A 的任务定义面：把「目标 + 模型 + 时间窗 + 成本上限」四元组变成萬星的一等公民——owner 在 console 声明 mission，显式状态机管生命周期，planner agent 按契约消费（派发回合+回写产物），mission 级成本闸在派发边界拒绝超支。本能力是数据与控制面；planner 的智能（拆解质量、步骤执行）不在其中。

## ADDED Requirements

### Requirement: A mission is the four-tuple owned by a console user

每条 mission SHALL 持有：owner（console 用户身份）、goal（一句话或多段目标文本）、model（执行模型选择）、时间窗（start 与 end 时刻）、costCapMinutes（≥1 的分钟整数）与审批模式（人批 or 自动）。创建 SHALL 校验四元组完整且时间窗 end 晚于 start；非法输入以结构化错误拒绝且不落行。mission 的修改在进入 planning 后 SHALL 限于 abort（四元组是 planner 的输入契约，不允许中途改写目标）。

#### Scenario: A valid mission is created in draft

- **WHEN** owner 提交合法四元组创建 mission
- **THEN** mission 以 draft 状态落库，携带全部声明字段与创建者身份

#### Scenario: An invalid four-tuple is rejected

- **WHEN** 创建请求缺 goal、costCapMinutes < 1 或时间窗 end 不晚于 start
- **THEN** 以结构化错误拒绝，无 mission 落库

#### Scenario: The four-tuple is frozen once planning starts

- **WHEN** mission 已进入 planning 及之后的状态
- **THEN** 四元组字段的修改被拒绝，唯一的人为出口是 abort

### Requirement: The lifecycle is an explicit state machine

mission SHALL 持有显式状态：`draft`、`submitted`、`planning`、`awaiting_approval`、`auto_approved`、`scheduled`、`executing`、终态 `reported` / `failed` / `aborted`。转移 SHALL 按角色受限于：owner 可 submit（draft→submitted）与 abort（非终态→aborted）；planner 回写可推进 planning→awaiting_approval|auto_approved（计划就绪）与 scheduled→executing（首步开跑）及落终态；审批模式下 owner 或 ops 的 approve 使 awaiting_approval→scheduled。每次转移 SHALL 记录时间戳与触发者。非法转移（含终态后再转移）SHALL 以结构化错误拒绝且状态不变。

#### Scenario: The approval-mode happy path walks the machine

- **WHEN** owner 创建（人批）、submit，planner 回写计划，owner approve，planner 开跑并回写报告
- **THEN** 状态依次为 draft→submitted→planning→awaiting_approval→scheduled→executing→reported，每次转移可追溯

#### Scenario: The auto mode skips the human gate

- **WHEN** mission 声明自动审批且计划就绪
- **THEN** 状态进 auto_approved 并可继续 scheduled，无人工动作参与

#### Scenario: An illegal transition changes nothing

- **WHEN** 任何角色对终态 mission 或未满足前置的状态发起转移
- **THEN** 请求以结构化错误拒绝，状态与时间戳不变

#### Scenario: Owner abort is always available before terminal

- **WHEN** owner 对非终态 mission 发起 abort
- **THEN** mission 进 aborted 并记录 abort 者，不再接受派发

### Requirement: Dispatch rides the existing agent lane with a scoped writeback

向 planner 的派发 SHALL 经既有 agent 回合通道（配置的 planner agent slug），消息携带 mission brief（四元组 + mission 标识 + 回写凭据 + 回写端点说明）；每次派发 SHALL 铸造该派发纪元的回写凭据——凭据在 mission 进入终态或下一次派发铸造新凭据时失效。planner 的产物（计划步骤数组、步骤状态、最终报告）SHALL 只能经回写端点以该凭据写入对应 mission；同一幂等键的重复回写 SHALL 幂等（同结果、不重复推进），凭据不携带任何 caller/key 材料。派发 SHALL 异步：提交受理即返回，planner 的进度经回写与状态机呈现。时间窗已结束的 mission SHALL 拒绝新派发并以结构化错误说明过期。

#### Scenario: A submitted mission dispatches to the planner

- **WHEN** mission 进 submitted 且派发通道可用、时间窗未结束
- **THEN** planner 收到一回合携带 brief 的消息，mission 进 planning，纪元回写凭据已随 brief 交付

#### Scenario: Writeback is token-gated and idempotent

- **WHEN** planner 持有效凭据回写计划，随后同凭据同幂等键重发
- **THEN** 首次回写落库并推进状态；重发返回同结果且不重复推进；失效纪元（终态后或新派发后）的凭据被拒绝

#### Scenario: Writeback respects the state machine

- **WHEN** planner 回写报告而 mission 尚在 scheduled
- **THEN** 该回写按状态机规则被拒绝或按声明落为非法转移，状态不被绕过

#### Scenario: An expired window refuses dispatch

- **WHEN** mission 的时间窗 end 已过而请求新派发
- **THEN** 派发被拒绝并返回结构化的过期错误，mission 不进 planning

### Requirement: The cost cap gates dispatch on the mission ledger

mission 回合 SHALL 在用量账本上携带 mission 维度（审计列）；mission 已花费分钟 SHALL 从账本派生（settled 与否都计入），绝不维护独立计数器。当已花费 ≥ costCapMinutes 时，该 mission 的新派发 SHALL 被拒绝（402 结构化错误 MISSION_EXHAUSTED），已开跑的回合不被中断。结算路径 SHALL 不变——cap 是派发闸，不是新结算器；账本按既有规则结算。

#### Scenario: Spent minutes derive from the ledger

- **WHEN** mission 下已有 3 个回合各记 1 分钟
- **THEN** 该 mission 的已花费分钟派生为 3，随新回合记账即时更新

#### Scenario: An exhausted mission refuses further dispatch

- **WHEN** 已花费 ≥ costCapMinutes 时请求该 mission 的下一步派发
- **THEN** 派发被拒绝并返回 402 MISSION_EXHAUSTED，mission 状态不变或按策略转 failed

#### Scenario: The cap never interrupts a running turn

- **WHEN** 回合进行中花费触及上限
- **THEN** 该回合自然结束并入账；拒绝只发生在下一次派发

### Requirement: The console surface exposes missions to owner and ops

console SHALL 提供「我的任务」面：owner 浏览自己的 mission 列表（状态、四元组摘要、已花费/上限、报告入口），详情页呈现计划步骤与状态历史；owner 可 approve（awaiting_approval 时）与 abort。ops SHALL 能查看全部 mission 并 abort。未配置 planner slug 时面板 SHALL 显式呈现降级态（可建 draft，submit 被拒并说明缺配置），绝不静默失败。

#### Scenario: The owner walks their missions

- **WHEN** owner 打开我的任务
- **THEN** 列表展示其全部 mission 的状态与成本摘要，详情可达计划与报告

#### Scenario: Ops oversight without ownership

- **WHEN** ops 查看任务面
- **THEN** 全部 mission 可见，abort 可用，owner 私有字段不出现在他人视图

#### Scenario: Ops may create on behalf of an owner

- **WHEN** ops 凭据携 ownerEmail 创建 mission 且该邮箱能解析到计费账户
- **THEN** mission 落在该账户名下（owner 在自己的列表里看到并可控）；邮箱不可解析则以账户不存在错误拒绝，不落行

#### Scenario: Unconfigured planner degrades visibly

- **WHEN** 未配置 MISSION_PLANNER_SLUG 时 owner submit
- **THEN** submit 被拒绝并显式说明 planner 未配置，draft 保留不丢

### Requirement: Lifecycle transitions feed the fleet event channel

每次状态机转移 SHALL 发一条 lifecycle 事件到既有 fleet 观测通道（kind 命名 mission 系），携带 mission 标识、owner、新状态与转移者；事件失败 SHALL 不影响转移本身。

#### Scenario: A transition lands as one event

- **WHEN** mission 由 draft 转 submitted
- **THEN** fleet 事件通道出现一条对应 mission 事件，字段完整

#### Scenario: Observability never blocks the transition

- **WHEN** fleet 通道不可达
- **THEN** 状态转移照常完成，事件丢失只记日志
