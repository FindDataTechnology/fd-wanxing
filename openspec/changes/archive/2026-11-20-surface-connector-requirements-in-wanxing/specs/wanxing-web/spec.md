# Spec Delta

## ADDED Requirements

### Requirement: agent 携带外部系统依赖投影

Each catalog entry（`/api/wanxing/v1/agents` 与单 agent 卡片）SHALL additionally carry the deployment's external-system requirement projection，使部署面能回答「这个 agent 要接几个外部系统、现在缺哪条」：

```
external_systems: {
  declared: N,        // 该包声明的 connector_bindings 条数
  required: R,        // 其中 optional !== true 的条数
  wired:    W,        // 部署期真正铸出绑定（已接通）的条数
  missing:  [ { key, optional } … ]   // 声明了但没接通
}
```

「已接通」SHALL 取自该部署注册条目自带的已铸绑定（`metadata.connector_bindings` 的 key 集合），MUST NOT 由声明面推断；「声明」SHALL 取自该包版本的清单（`connector_bindings`）。两者按 binding `key` 对齐。

#### Scenario: 全接通的部署

- **WHEN** 包的清单声明 2 条绑定，且该部署注册条目携带同名的 2 条已铸绑定
- **THEN** 投影为 `{declared:2, required:2, wired:2, missing:[]}`

#### Scenario: 有缺口的部署

- **WHEN** 包声明 2 条绑定，注册条目只携带其中 1 条
- **THEN** `missing` 恰含未接通的那条 key，并带上它自己的 `optional` 标记

#### Scenario: optional 绑定不计入 required 但仍出现在缺口里

- **WHEN** 包声明 1 条必需 + 1 条 optional，两条都未接通
- **THEN** `required` 为 1，而 `missing` 含两条且各自带 `optional: true/false`

### Requirement: 投影的缺席、空缺口、有缺口三种事实不可互相冒充

投影 SHALL 区分三种事实：**包未声明连接器绑定**（键缺席）、**声明了且全部接通**（`missing` 为空）、**声明了但有缺口**（`missing` 非空）。键缺席 MUST NOT 渲染为零需求；读取失败（包详情或注册条目不可达）SHALL 同样降级为缺席，MUST NOT 降级为空缺口。

投影 MUST NOT 携带绑定令牌、secret 名、连接器 URL 或任何凭据材料——只有 key、optional 标记与聚合数字。

#### Scenario: 未声明不渲染为零

- **WHEN** 包的清单没有 `connector_bindings`
- **THEN** 投影键缺席（或显式标记未声明），MUST NOT 呈现 `declared: 0` 让人读成「零需求」

#### Scenario: 读取失败不伪装成无缺口

- **WHEN** 包详情或注册条目读不到
- **THEN** 投影缺席，MUST NOT 报告 `missing: []`（那等于宣称「全接通」）

#### Scenario: 投影不含凭据

- **WHEN** 检查投影任意字段与任意嵌套层级
- **THEN** 只有 binding key、optional 标记与聚合计数，无 token、无 secret 名、无连接器地址

### Requirement: 详情页呈现外部系统段

The agent detail view SHALL render an 外部系统 section carrying the projection: 需求 N · 已接通 K，以及缺口逐条列出（标明必需/可选）。该段 SHALL 在投影缺席时显式写「未声明」，在 `missing` 非空时给出去处——回链到凭据修复面（壹座连接的连接器卡片），使部署者能从萬星一步走到该修的地方。

该段 SHALL NOT 改变该页既有的三部分结构（是什么 / 现在怎样 / 怎么接入），SHALL NOT 与主状态徽标争夺同一强调级：它是「部署配置」的事实，不是运行健康。

#### Scenario: 全接通时一句话

- **WHEN** 详情页渲染一个全部绑定已接通的 agent
- **THEN** 外部系统段显示「需求 N · 已接通 N」且不列缺口

#### Scenario: 有缺口时逐条列出并可修

- **WHEN** 投影的 `missing` 含两条，其中一条可选
- **THEN** 该段逐条列出两个 binding key 并区分必需/可选，且提供指向凭据修复面的链接

#### Scenario: 未声明与零缺口措辞不同

- **WHEN** 包的清单未声明连接器绑定
- **THEN** 该段写「未声明」（而不是「需求 0 · 已接通 0」）

### Requirement: 运维时间线把连接器身份登记失败渲染成可读语义

The ops timeline SHALL render the `connector_identity_unregistered` event with human-readable semantics:该回合的访客身份登记未完成，因此该回合的连接器调用会被拒绝（fail-closed，不回落部署者）。该行 SHALL additionally surface the event payload's failure code 与访客档位，使运维能区分「登记链坏了」（平台/门面侧故障）与「访客未登记」（访客侧）。

其他事件 kind 的呈现 SHALL 保持不变；未知 kind SHALL 继续按原始形式呈现而非被丢弃。

#### Scenario: 登记失败事件可读

- **WHEN** 时间线包含一条 `connector_identity_unregistered` 事件
- **THEN** 该行以一句话说明「访客身份登记未完成 → 本回合连接器调用会被拒」，并显示其 code 与 tier

#### Scenario: 其它事件不受影响

- **WHEN** 时间线包含 turn_started / settled 等既有 kind
- **THEN** 这些行按既有形式渲染，文案不变

#### Scenario: 未知 kind 不被吞掉

- **WHEN** 时间线包含一个本仓库不认识的 kind
- **THEN** 该行仍按原始 kind + payload 呈现，不隐藏
