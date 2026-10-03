# 萬星（Wanxing）

寻数五线（壹座/识律/柏讯/谦面/萬星）中 **constellation 线的独立产品**：Agent 服务的
对外运行与服务平台——部署、驻留、门面、计费与机群观测。

2026-10-04 定案：萬星从 paas（壹座+谦面所在仓）**分阶段独立**为本项目。定位与阶梯
见 [ADR-0001](docs/adr/0001-wanxing-is-an-independent-project.md)；推进计划见
[program 文档](docs/program/wanxing-independence.md)。

## 本仓现在有什么

| 组件 | 状态 |
|---|---|
| fleet 观测面（事件主干 + rollup + 观测 API） | 本仓原生，随切片③落地 |
| wanxing-web（公共目录 + 部署者控制台 + 文档门面） | 本仓原生，切片⑤ |
| wanxing facade（A2A 门面+边界结算） | 暂居 paas `gateway/wanxing/`，L2 拆面（切片②）时迁入 |
| agent-runner（多租户运行时） | 暂居 paas `agent-runner/`，facade 之后迁入 |

## 借用契约（不归本仓，经显式契约访问）

- **謙面 registry**（运行时真相+路由；paas ADR-0015）与 **packs 部署台账**（packs internal API，env 可重指）
- **sub2api 计费面**（调用键/部署键/结算）

对兄弟线只经 HTTP 契约访问、env 可重指——这条纪律守住，L3（对外私有交付）才有得谈。

## 相关

- 母仓：`paas`（壹座 platform + 谦面 marketplace + 既有萬星 specs，迁入时 fork）
- 品牌与五线语言：`~/finddata/CONTEXT.md`
- 对接一页纸（调用侧）：paas `docs/wanxing-serving-api.md`（迁入前的权威版本）
