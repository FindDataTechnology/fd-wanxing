# wanxing-facade Specification

## ADDED Requirements

### Requirement: The facade speaks to the facet packs surface as the verified console identity

facade SHALL 经转发身份通道（facet 内部凭据 + `x-facet-user` 携 console 身份）调 facet 的 packs 公面；通道未配置（env 缺任一键）时自助面 SHALL 显式降级（503 + 指引文案），绝不静默空列表。转发请求 SHALL 不携带 facet 内部凭据以外的任何服务凭据。

#### Scenario: The channel is configured and forwards identity

- **WHEN** 已配置通道且已验证身份的 console 用户请求自助面
- **THEN** facet 收到的调用带该用户身份，作者过滤返回其本人的 pack

#### Scenario: Unconfigured degrades visibly

- **WHEN** 通道未配置时请求自助面
- **THEN** 503 与明确的配置指引，面板显示降级态而非空成功

### Requirement: Deployers list their own deployable packs

`GET /console/my/packs` SHALL 以验证身份解析作者，返回其名下已发布 pack 的概要列表：pack id/名称/最新版本/可见性/是否含 serving 契约 agent（可部署性）/既部署 slug（若有）。列表 SHALL 只含本人作品；无 facet 记录时 SHALL 为空数组。

#### Scenario: The author sees only their packs

- **WHEN** 部署者请求 my/packs
- **THEN** 返回的每个 pack 的作者都是该身份，含可部署性与最新版本

#### Scenario: Nothing published reads empty, not missing

- **WHEN** 身份名下无已发布 pack
- **THEN** 返回空数组与 200

### Requirement: A deployer deploys their own pack through the facade

`POST /console/my/packs/:id/deploy` SHALL 校验：pack 属于该身份（否则 404）、body 携 billing key（serving 部署硬要求，缺失 400 指引）、版本缺省为最新。请求 SHALL 以同身份转发 facet deploy 端点并透传其结构化错误（如余额门/模型道校验失败）；成功 SHALL 返回部署结果与 agent slug。billing key SHALL 仅入部署引用，响应与日志不回显。

#### Scenario: A creator deploys their chat agent

- **WHEN** 部署者选最新版本、携自己的计费键提交
- **THEN** facet 完成部署，响应含 agent slug，分享卡可即刻拼出对话 URL

#### Scenario: A foreign pack is not deployable through my face

- **WHEN** 请求部署不属于该身份的 pack
- **THEN** 404，且不发生任何 facet 转发

#### Scenario: Facet refusals pass through verbatim

- **WHEN** facet 拒绝部署（如计费键无效）
- **THEN** 响应携带 facet 的结构化错误码与文案

### Requirement: The share card answers "where is my page"

自助面 SHALL 提供分享信息：agent slug 的完整对话 URL（`#/chat/<slug>`）、chatability 状态（公网+未暂停+瀑布可用）、部署者额度余量与配置指引。信息由既有面拼装，不新增存储。

#### Scenario: The share card reads green

- **WHEN** 部署成功的 public agent 且瀑布开着
- **THEN** 分享卡给出完整 URL 与 chatability=true，附额度配置指引

#### Scenario: Not yet chatable says why

- **WHEN** agent 私有或额度未配置
- **THEN** 分享卡如实给出不可对话的原因与对应配置入口
