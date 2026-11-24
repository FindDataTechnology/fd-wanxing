# wanxing-borrowed-contracts Specification

## Purpose
萬星对四条不归本仓所有的能力边界——謙面 registry、packs 部署台账、sub2api 计费面、agent-runner——的借用纪律契约：只经 HTTP（或既定协议端点）+ env 可重指访问，禁止库直连与进程内耦合。守住它是萬星对外私有交付（L3）的前提；本 spec 同时是变量编址的一处可发现清单。

## Requirements

### Requirement: 借用边界只经 HTTP 契约

萬星（facade、fleet-observer 及后续自有组件）对謙面 registry、packs 部署台账、sub2api 计费面、agent-runner 四条借用边界的全部访问 SHALL 经 HTTP（或既定协议端点）+ 环境变量编址；MUST NOT 直连兄弟线的数据库或进程内 import 兄弟线代码。

#### Scenario: 借用服务迁移地址
- **WHEN** 任一借用服务（registry/packs/sub2api/agent-runner）更换部署地址
- **THEN** 萬星侧仅需更新对应环境变量即可恢复，代码零改动

#### Scenario: 违约直连被拒绝
- **WHEN** 评审新增的萬星代码出现对兄弟线数据库的连接串或对 paas 模块的进程内 import
- **THEN** 该改动不通过评审，必须改走 HTTP+env 契约

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

### Requirement: agent-runner 为正式借用边界

agent-runner SHALL 按借用边界管理（不在遷入计划内）：其归属、部署形态（paas platform 镜像同镜像第三角色）与调用契约与 registry/sub2api/packs 同列。program 文档与 ADR MUST 记录本裁决（2026-11-06），萬星侧 MUST NOT 残留「待迁入 runner」的悬挂假设。

#### Scenario: 查阅独立 program
- **WHEN** 读者查阅 `docs/program/wanxing-independence.md`
- **THEN** agent-runner 的状态为「正式借用边界（2026-11-06 裁决）」而非「待迁入」，且全文不存在与之矛盾的条目

#### Scenario: 若未来需要迁移
- **WHEN** 用户决定迁移 agent-runner
- **THEN** 另立专项 change 显式推翻本裁决，本 spec 相应修订

### Requirement: 借用边界的入向消费者同属契约

萬星公开读面——目录 `GET /api/wanxing/v1/agents`、用量 `GET /api/wanxing/v1/ops/usage`、舰队板 `GET /api/fleet/v1/board`、A2A 回执 `POST /api/wanxing/v1/a2a/{slug}`、agent-card `GET …/.well-known/agent-card.json`、调用者偏好 `GET|PUT /api/wanxing/v1/prefs/{slug}`——的响应形状被兄弟线消费，其被消费字段 SHALL 登记在下表内。任一对被消费字段的改名、删除或语义变更 SHALL 视为契约变更：必须升 `x-contract-rev` 并在生产者与消费者两侧同步校验。被消费字段 MUST NOT 发生静默的语义漂移（字段名不变而口径改变，例如把「七日外部回合数」改成「全部回合数」）。

入向消费者表（`contracts/wanxing-public-api.v1.json` 的 `$defs` 与之逐面对应）：

| 面 | `$defs` | 消费者 | 消费者钉住的字段 |
|---|---|---|---|
| `GET /api/wanxing/v1/agents` | `agentsResponse` / `catalogEntry` | 谦面供给脊柱（`facet/supply-catalog.js` → `/api/facades-catalog`）、萬星运维 MCP | `slug`、`name`、`description`、`status`、`status_as_of`、`chatable`、`category`、`featured`、`turns7d`、`cluster` |
| `GET /api/wanxing/v1/ops/usage` | `opsUsageResponse` | 壹座主人跨线视图（`server/routes/fleets.js` 的 `byCaller[]`） | `email`、`turns`、`minutes`、`usd`、`pending` |
| `GET /api/fleet/v1/board` | `fleetBoardResponse` | 壹座 ops-console、萬星 web 控制台 | `states`、`runners`、`ingest_lag`、`settled_pending`、`wake_ms`、`agents_total`、`leases`、`runner_liveness` |
| `POST /api/wanxing/v1/a2a/{slug}` | `turnReceipt` | 柏讯工单直连（`fd_wire_api/demands/wanxing.py`）、萬星运维 MCP | `result.parts[].kind`、`result.parts[].text`、`result.messageId`、`error.code` |
| `GET …/.well-known/agent-card.json` | `agentCard` | 萬星运维 MCP、任何先解析后调用的 A2A 客户端 | `name`、`description`、`url`、`capabilities`、`skills` |
| `GET\|PUT /api/wanxing/v1/prefs/{slug}` | `prefsResponse` | 谦面 CLI `facet prefs`（`paas/facet/cli/facet.js`） | `prefs.callbackUrl`、`prefs.callbackSecretSet`、`prefs.reapMinutes` |
| `public/copilot.js` + `wx-copilot-*` 宿主协议 | `copilotHost` | 识律控制台副驾（`fd-lex`）等各产品线宿主页 | 四条宿主→组件消息（`wx-copilot-init` / `wx-copilot-identity` / `wx-copilot-context` / `wx-copilot-intent-result`）、四条组件→宿主消息（`wx-copilot-ready` / `wx-copilot-identity-request` / `wx-copilot-state` / `wx-copilot-intent`）、载荷键 `intents`、`token`、`open`、`verb`、`arg`、`slug`，以及四个钩子（`identify` / `context` / `intents` / `onEvent`） |

宿主协议那一行曾以「无机器可读定义，缺口」入表，随后补成 `$defs.copilotHost` 并由源码对账判据钉住
（契约里点名的消息类型必须与 `public/copilot.js` 实际收发的一致，任一侧改名即红）——把它登记在册
的效果就是它会自己收敛。

调用者偏好那一行是**事后补登记**：该面早已被谦面 CLI 消费，但一直没进表（2026-11-13 扫
「被兄弟线读却没登记的面」时撞出）。补登记同时给出 `$defs.prefsResponse` 与一条驱动真路由的
判据（GET/PUT 两侧 check + coverage，并硬断言签名密钥永不出现在响应里）。

#### Scenario: 新增跨仓消费者

- **WHEN** 兄弟线新增一处对萬星公开读面的读取
- **THEN** 该消费者与其钉住的字段进入上表对应的一行，契约修订号随之升号

#### Scenario: 被消费字段被改名

- **WHEN** 提交把消费侧依赖的字段改名或移除，而契约修订号未升号
- **THEN** 该改动不通过评审

#### Scenario: 被消费字段口径漂移

- **WHEN** 提交保持字段名不变但改变了其口径（如活跃度的统计窗口）
- **THEN** 该改动同样按契约变更处理，必须升号并同步两侧校验

### Requirement: 公开面发出的每个字段都必须在契约里具名

公开读面的响应形状 SHALL 被完整声明，而非仅声明"被消费的那几个字段"。生产者发出的每一个键——包括顶层统计、分组映射、以及回执内部（`result` 之下）的形状——SHALL 在契约文件中有一个声明；未声明即视为契约缺口，由生产者一侧的覆盖判据（`contract.coverage()`）在 CI 中判红，MUST NOT 依赖消费者逐个发现。

理由是可数的：本 change 之前，同一类缺口在人工比对中被撞出三次（`facets.clusters`、agent-card 的五个字段、回执的 `result.parts` 等），每一次都是"消费方读到空值"才暴露。校验器只走已声明的键（JSON Schema 允许未知属性），所以**多发字段对它是隐形的**——这份判据补的正是那个盲区。

契约 MAY 把某个对象声明为自由形态（`{"type":"object"}` 且无 `properties` 与 `additionalProperties`），此时其内部不再要求逐键具名；该写法 SHALL 表示"故意不描述"，而非"还没来得及写"。

#### Scenario: 面新增了一个字段但契约没跟

- **WHEN** 公开面开始发出一个契约未声明的键
- **THEN** 生产者一侧的覆盖判据判红并点名该键的路径，改动不得合入

#### Scenario: 回执的内部形状被当作自由形态

- **WHEN** 某个回执面只声明了外壳（如 `result: {"type":"object"}`）而未描述内部
- **THEN** 该面按缺口处理，补齐内部声明后才视为满足本条

#### Scenario: 故意保留的自由形态对象

- **WHEN** 契约把一个对象显式声明为无 `properties`、无 `additionalProperties` 的 `object`
- **THEN** 覆盖判据不深入其内部，该声明即为其完整性依据

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

### Requirement: 契约声明的每个字段都必须能被发端观测到

公开读面契约的另一半：契约里具名的每一个键 SHALL 有一个判据能证明发端会真的发出它。声明了
发端从不发出的键 MUST 视为契约缺陷——它与漏声明同等严重，只是症状相反：漏声明让消费者
"读到空值才发现"，假声明让消费者"按契约写死、永远拿到 `undefined` 却不报错"（JSON Schema
只校验出现的键，多声明的键对它是隐形的）。

判据 SHALL 用**真的**发端跑出来（真存储、真路由、真实输入），而不是由测试自己造一份期望形状
——自己写的期望只能证明自己。纯条件键（只有满足某条件才出现，如只有声明了节奏的 agent 才有
`declared_every_ms`）MUST 进一份显式的豁免表，并写明出现条件；MUST NOT 以"这次没出现"作为
通过的依据。

#### Scenario: 契约声明了发端从不发出的键

- **WHEN** 契约某个面声明了一个键，而真的发端在完整输入下从不发出它
- **THEN** 双向形状判据判红并点名该键的路径，改动不得合入

#### Scenario: 条件键未进豁免表

- **WHEN** 某个键只在特定条件下出现，而它没有进豁免表
- **THEN** 判据在条件不满足的那一次判红，迫使作者把它登记为条件键并写明条件

#### Scenario: 判据必须能被证明会红

- **WHEN** 新增或修改本类判据
- **THEN** 提交记录里必须有一次性把契约改错、看到判据报出该键名的证据；只看到"绿"不算验证过判据

### Requirement: A paged list read of a borrowed registry is followed to exhaustion

读取借用 registry 的列表读面时，调用方 SHALL 跟随 `has_next` 读全，MUST NOT 把一页当作全集。registry 的列表默认每页 20 条并返回 `{ total_count, limit, offset, has_next }`，把第一页当全集会在无任何错误的情况下静默漏掉尾部条目。

读取 SHALL 有界：页数上限与总时间预算 SHALL 明确，触顶时调用方 SHALL 显式记录「读到的条数少于上报总数」的事实，MUST NOT 把截断后的集合当作完整集合继续推理。

#### Scenario: Tail entries are not silently dropped

- **WHEN** registry 上报 `total_count` 大于一页的 `limit`
- **THEN** 调用方继续按 `offset` 读取直到 `has_next` 为假，或直到触达页数/时间上限

#### Scenario: Truncation is named, not hidden

- **WHEN** 读取在触达上限时仍有 `has_next`
- **THEN** 调用方记录一条明确的截断事实（含已读条数与上报总数），而不是返回一个看起来完整的集合

#### Scenario: A registry that ignores offset does not loop forever

- **WHEN** registry 对 `offset` 无反应、重复返回同一页
- **THEN** 调用方检测到重复页并停止，不无限循环
