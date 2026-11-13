# 萬星（Wanxing）

寻数五线（壹座/识律/柏讯/谦面/萬星）中 **constellation 线的独立产品**：Agent 服务的
对外运行与服务平台——部署、驻留、门面、计费与机群观测。

2026-10-04 定案：萬星从 paas（壹座+谦面所在仓）**分阶段独立**为本项目。定位与阶梯
见 [ADR-0001](docs/adr/0001-wanxing-is-an-independent-project.md)；推进计划见
[program 文档](docs/program/wanxing-independence.md)。

## 本仓现在有什么

| 组件 | 状态 |
|---|---|
| wanxing facade（A2A 门面+边界结算） | 本仓 `services/wanxing-facade/`（19 模块，独立部署单元，现网 `sha-8692179`） |
| fleet 观测面（事件主干 + rollup + 观测 API） | 本仓 `services/fleet-observer/` |
| stats-collector（本机 harness 消耗收集器） | 本仓 `services/stats-collector/`（跑在用户机，无服务端部署——设计如此） |
| wanxing-web（公共目录 + 部署者控制台 + 文档门面） | 本仓 `wanxing-web/`（wanxing.finddatatech.cloud，雷池→Caddy→NodePort 31880） |
| agent-runner（多租户运行时） | **paas 借用边界**（2026-11-06 裁决：正式按借用契约，不迁入；见 [ADR-0005](docs/adr/0005-agent-runner-is-a-borrowed-contract.md)） |

部署真源：GitOps 仓 `fd-infra-deploy`（all-services/prod/）+ ArgoCD `all-services-prod`，见 [deploy/README](deploy/README.md)。

## 借用契约（不归本仓，经显式契约访问）

本仓**借出**的能力（萬星依赖别人）：

- **謙面 registry**（运行时真相+路由；paas ADR-0015）与 **packs 部署台账**（packs internal API，env 可重指）
- **sub2api 计费面**（调用键/部署键/结算）
- **agent-runner**（多租户运行时；2026-11-06 起正式列为借用边界）
- **谦面 packs 面（部署者自助）**：`FACET_BASE_URL` / `FACET_INTERNAL_TOKEN`，以转发身份调用
- **副驾技能**：正式源是两个外部仓——源文在 `finddata-skills`（gitee），registry 条目只是它的投影；见 [ADR-0006](docs/adr/0006-copilot-skills-source-of-truth.md)

本仓**被借**的公开读面（别人依赖萬星——改形状要升契约修订号）：

- `GET /api/wanxing/v1/agents` — 谦面供给脊柱、萬星运维 MCP
- `GET /api/wanxing/v1/ops/usage` — 壹座主人跨线视图
- `GET /api/fleet/v1/board` — 壹座 ops-console、萬星 web 控制台
- `POST /api/wanxing/v1/a2a/<slug>` — 柏讯工单直连、萬星运维 MCP、数据工厂工单链
- `public/copilot.js` + `wx-copilot-*` 宿主协议 — 识律控制台副驾

对兄弟线只经 HTTP 契约访问、env 可重指——这条纪律守住，L3（对外私有交付）才有得谈。

### 变量编址表（以 `services/wanxing-facade/env.js` 为准）

同一上游被不同组件用不同变量族称呼过，门面内部还曾出现"同一上游、两条代码路径、两套别名"。
现在所有出向读取都过 `resolve()`/`resolveBase()`，本表是那张表的**镜像**：
`scripts/test-env-table.mjs` 双向核对（表里的名字必须都在 `env.js` 里，`env.js` 的名字必须都在表里），
所以它不会偷偷过期。规范名优先，别名只在前者为空时生效。

<!-- env-table:start -->
| 组件 | 上游 | 地址（规范 → 别名） | 凭据（规范 → 别名） |
|---|---|---|---|
| facade | registry | `AGENT_SERVING_REGISTRY_URL` → `REGISTRY_URL` | `AGENT_SERVING_REGISTRY_TOKEN` → `MARKET_REGISTRY_TOKEN` |
| facade | registry（后端读） | — | `AGENT_SERVING_BACKEND_TOKEN` |
| facade | packs 台账 | `PACKS_INTERNAL_BASE_URL`（缺省指本进程市场） | — |
| facade | sub2api | `SUB2API_BASE_URL` | `SUB2API_ADMIN_KEY` |
| facade | memory | `CELL_MEMORY_URL` → `FD_MEMORY_URL` | `CELL_MEMORY_PLATFORM_TOKEN` → `FD_MEMORY_PLATFORM_TOKEN` |
| facade | facet packs 面 | `FACET_BASE_URL` | `FACET_INTERNAL_TOKEN` |
| facade | fleet 观测面 | `FLEET_OBSERVER_URL` | `FLEET_OBSERVER_TOKEN` |
| observer | registry | `FLEET_REGISTRY_URL` | `FLEET_REGISTRY_TOKEN` |
| observer | sub2api | `FLEET_STATS_SUB2API_BASE_URL` → `FLEET_STATS_SUB2API_BASE` | `FLEET_STATS_SUB2API_TOKEN` |
| observer | 事件接收 | — | `FLEET_INGEST_TOKEN` |
| observer | stats 采集 | — | `FLEET_STATS_COLLECTOR_TOKEN` |
| collector | fleet 观测面 | `OBSERVER_URL` | `FSC_TOKEN` |
<!-- env-table:end -->

agent-runner 没有自己的地址：它经 registry 代理调用（表里标 `proxied`），所以不出现在上表。

### 公开面的机器可读契约

被消费的形状写在 [`contracts/wanxing-public-api.v1.json`](contracts/wanxing-public-api.v1.json)：
顶层 `x-contract-rev` 是修订号，`$defs` 里每条字段的 `description` 点名**谁在消费它**。

- 改名、删除、或改变被消费字段的**语义**（哪怕键名不变）→ 必须升 `x-contract-rev`，并同步两侧的形状校验。
- 纯附加字段不升号（消费方本就忽略未知键）。
- **面发出的每个键都要具名**：校验器只走已声明的键（JSON Schema 允许未知属性），所以
  "多发了字段"对它是隐形的。`contract.coverage()` 补这个盲区——四处真 payload（目录、
  用量、舰队板、agent-card、回执两种生产者形状）各跑一遍，未声明的键直接判红。这一条
  不是洁癖：本仓之前靠人眼撞出过三次同类缺口才补上判据。
- 兄弟线持**逐字节相同**的副本（`paas/facet/contract/`），跨仓一致性由工作区根的
  `scripts/check_wanxing_contract_drift.py` 对账（非零退出即漂移）。
- 漂移检查按**工作树**比对，所以它天然会看见"分支还没合"：paas 侧在别的分支上时，
  默认路径会报 `missing consumer twin` / `bytes differ`。这不是漂移，是分支差——
  `--consumer-dir` 指到持有新副本的工作树即可（本仓改动落进 paas 主线后自动一致）。

## 相关

- 母仓：`paas`（壹座 platform + 谦面 marketplace；其 `gateway/wanxing/` 为 platform 域 twin 面，摘挂计划见 change `unify-wanxing-a2a-face`）
- 品牌与五线语言：`~/finddata/CONTEXT.md`
- 对接一页纸（调用侧）：`docs/wanxing-serving-api.md`
