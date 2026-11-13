## MODIFIED Requirements

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
