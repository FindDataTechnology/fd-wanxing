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

- **謙面 registry**（运行时真相+路由；paas ADR-0015）与 **packs 部署台账**（packs internal API，env 可重指）
- **sub2api 计费面**（调用键/部署键/结算）
- **agent-runner**（多租户运行时；2026-11-06 起正式列为借用边界）

对兄弟线只经 HTTP 契约访问、env 可重指——这条纪律守住，L3（对外私有交付）才有得谈。
四条边界的变量编址清单见 spec `wanxing-borrowed-contracts`。

## 相关

- 母仓：`paas`（壹座 platform + 谦面 marketplace；其 `gateway/wanxing/` 为 platform 域 twin 面，摘挂计划见 change `unify-wanxing-a2a-face`）
- 品牌与五线语言：`~/finddata/CONTEXT.md`
- 对接一页纸（调用侧）：`docs/wanxing-serving-api.md`
