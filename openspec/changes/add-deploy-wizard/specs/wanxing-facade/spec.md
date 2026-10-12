## MODIFIED Requirements

### Requirement: A deployer deploys their own pack through the facade

`POST /console/my/packs/:id/deploy` SHALL 校验：pack 属于该身份（否则 404）、body 携 billing key（serving 部署硬要求，缺失 400 指引）、版本缺省为最新。请求 SHALL 以同身份转发 facet deploy 端点并透传其结构化错误（如余额门/模型道校验失败）；成功 SHALL 返回部署结果与 agent slug。billing key SHALL 仅入部署引用，响应与日志不回显。

The body MAY carry the wizard payload: `agents` (a non-empty array of serving agent ids selecting the subset to deploy), and per-agent initial service config — `models`, `budgets`, `rhythms` mapping agent id to the deploy-time value. The facade SHALL forward `agents` verbatim and SHALL map the single billing key and the optional notify channel over the **selected** agents only (an omitted `agents` maps over every serving agent, exactly as before). Facet's validation is authoritative: shape errors and structured refusals (unknown agent, bad rhythm, lane rejection, …) SHALL pass through verbatim rather than being re-derived facade-side. `GET /console/my/packs` SHALL enrich each deployable agent with the serving contract's declared `modelWhitelist` when present, so wizard model inputs can hint the legal domain.

#### Scenario: A creator deploys their chat agent

- **WHEN** 部署者选最新版本、携自己的计费键提交
- **THEN** facet 完成部署，响应含 agent slug，分享卡可即刻拼出对话 URL

#### Scenario: A foreign pack is not deployable through my face

- **WHEN** 请求部署不属于该身份的 pack
- **THEN** 404，且不发生任何 facet 转发

#### Scenario: Facet refusals pass through verbatim

- **WHEN** facet 拒绝部署（如计费键无效）
- **THEN** 响应携带 facet 的结构化错误码与文案

#### Scenario: A wizard subset deploys only the checked agents

- **WHEN** 部署者携 `agents: ["alpha"]` 与按 alpha 的 models/budgets/rhythms 提交（pack 含 alpha、beta 两个 serving agent）
- **THEN** 转发给 facet 的 billingKeys/notifyChannel 只映射 alpha，`agents` 原样转发，响应只含 alpha 的部署结果与 slug

#### Scenario: The selection's refusals surface facet-side

- **WHEN** `agents` 含非 serving 的 id 或 rhythm 形状非法
- **THEN** facet 的 400（指名错误项）透传给向导，facade 不自行改写或吞掉

#### Scenario: my/packs carries the model whitelist hint

- **WHEN** 部署者请求 my/packs 且某 agent 的 serving 契约声明了 modelWhitelist
- **THEN** 该 agent 的 deployableAgents 项含此清单；未声明时该项无该字段（不伪造空数组）
