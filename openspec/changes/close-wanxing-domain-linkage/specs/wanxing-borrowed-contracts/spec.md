## ADDED Requirements

### Requirement: 借用边界的入向消费者同属契约

萬星公开读面——目录 `GET /api/wanxing/v1/agents`、用量 `GET /api/wanxing/v1/ops/usage`、舰队板 `GET /api/fleet/v1/board`——的响应形状被兄弟线消费，其被消费字段 SHALL 登记在本 spec 的入向消费者表内。任一对被消费字段的改名、删除或语义变更 SHALL 视为契约变更：必须升 `x-contract-rev` 并在生产者与消费者两侧同步校验。被消费字段 MUST NOT 发生静默的语义漂移（字段名不变而口径改变，例如把「七日外部回合数」改成「全部回合数」）。

#### Scenario: 新增跨仓消费者

- **WHEN** 兄弟线新增一处对萬星公开读面的读取
- **THEN** 该消费者与其钉住的字段进入本 spec 的入向消费者表，契约修订号随之升号

#### Scenario: 被消费字段被改名

- **WHEN** 提交把消费侧依赖的字段改名或移除，而契约修订号未升号
- **THEN** 该改动不通过评审

#### Scenario: 被消费字段口径漂移

- **WHEN** 提交保持字段名不变但改变了其口径（如活跃度的统计窗口）
- **THEN** 该改动同样按契约变更处理，必须升号并同步两侧校验

### Requirement: 谦面 packs 面为第五条借用边界

部署者自助通道——`FACET_BASE_URL` 与 `FACET_INTERNAL_TOKEN`，以转发身份调用谦面 packs 面——SHALL 与 registry、packs 部署台账、sub2api 计费面、agent-runner 同列为借用边界：只经 HTTP + 环境变量编址，凭据缺失时显式降级，MUST NOT 回落到谦面数据库直连或进程内 import。

#### Scenario: 自助通道未配置

- **WHEN** `FACET_BASE_URL` 或 `FACET_INTERNAL_TOKEN` 任一缺失
- **THEN** 自助端点返回 503 并指名缺失的变量，MUST NOT 返回空列表冒充「没有可部署的包」

#### Scenario: 自助通道迁移地址

- **WHEN** 谦面 packs 面更换部署地址
- **THEN** 仅需更新对应环境变量即可恢复，代码零改动

### Requirement: 契约修订号与跨仓一致性夹具

被消费的公开读面形状 SHALL 以机器可读契约声明于本仓 `contracts/wanxing-public-api.v1.json`，并携带 `x-contract-rev`。萬星侧每个被消费的公开读面 SHALL 有一条按其声明校验自身响应的测试；兄弟线消费者 SHALL 各持一份按同一修订号校验的测试。两仓契约副本的修订号与形状 SHALL 由根层对账脚本比对。

#### Scenario: 形状漂移被萬星侧测试拦下

- **WHEN** 某公开读面删改被消费字段或新增必填字段，而契约与测试未同步
- **THEN** 契约测试失败并指出漂移的字段名

#### Scenario: 跨仓副本不一致

- **WHEN** 两仓契约副本的 `x-contract-rev` 或形状不同
- **THEN** 根层对账脚本以非零退出码报错并列出差异

#### Scenario: 消费者按同一修订号校验

- **WHEN** 兄弟线消费者升级到同一 `x-contract-rev`
- **THEN** 其本地形状校验通过，且在生产观察到的不一致可归因到部署版本而非契约

### Requirement: 浏览器接入面同属契约

萬星对外发布的浏览器接入面——`copilot.js` 脚本与其 `wx-copilot-*` 宿主协议——SHALL 与 HTTP JSON 读面同列为契约的一部分：宿主站点以一段 `<script>` 接入后，脚本地址、协议帧名与字段语义的任何变化都是契约变更，必须升 `x-contract-rev`。萬星 SHALL 提供一种不依赖宿主改源码的地址指定方式（宿主可在接入点声明、或在构建期以变量注入），使萬星域变更不需要逐个宿主仓改代码。宿主侧 MUST NOT 在源码内写死萬星域名。

#### Scenario: 宿主以声明方式给出接入地址

- **WHEN** 一个宿主站点接入副驾
- **THEN** 萬星的接入地址来自宿主的部署配置或接入点声明，而不是宿主源码里的字符串常量

#### Scenario: 萬星域变更

- **WHEN** 萬星的对外域名或脚本路径发生变化
- **THEN** 宿主仅需更新其配置即可恢复，代码零改动；且当宿主未更新时，失效表现为可见的错误提示而不是「页面右下角什么都没有」

#### Scenario: 协议帧变更视为契约变更

- **WHEN** `wx-copilot-*` 的帧名、必填字段或语义发生变化，而契约修订号未升号
- **THEN** 该改动不通过评审

## MODIFIED Requirements

### Requirement: 借用依赖可发现且 env 双名兼容

五条借用边界的现役环境变量名 SHALL 在仓库内一处可发现（本 spec 与 README 借用契约段），清单 MUST 按「边界 × 组件族」列出——同一上游在不同组件里用不同变量族这件事（如 facade 的 `AGENT_SERVING_REGISTRY_URL||REGISTRY_URL`、`AGENT_SERVING_REGISTRY_TOKEN||MARKET_REGISTRY_TOKEN` 对 observer 的 `FLEET_REGISTRY_URL`/`FLEET_REGISTRY_TOKEN`）必须写在表内，不得只列其中一族；历史上双名兼容的变量 SHALL 保持既有解析优先级不变，且同一上游在同一条代码路径上 MUST NOT 出现两种不同的双名规则。

#### Scenario: 新会话排查借用依赖

- **WHEN** 开发者需要查「萬星依赖了哪些外部服务、用什么变量编址」
- **THEN** 从本 spec 与 README 的借用契约段即可获得完整清单，无需翻代码

#### Scenario: 同一上游的变量族被分开列明

- **WHEN** 读者查看 registry 一侧的编址清单
- **THEN** facade 与 observer 两套变量族并列可见，且标注它们指向同一个上游

#### Scenario: 同路径双名规则一致

- **WHEN** 同一组件内有两条代码路径访问同一个借用上游
- **THEN** 两者接受的双名集合与优先级完全相同
