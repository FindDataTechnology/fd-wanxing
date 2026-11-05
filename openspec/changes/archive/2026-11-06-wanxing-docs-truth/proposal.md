# 萬星文档与账本对齐现实（wanxing-docs-truth）

## Why

三份「给人看的现状文档」全部冻结在立仓期：README.md:16 仍说 facade「暂居 paas，L2 拆面时迁入」（实际 10-04 当天已迁入，README 零改动）；`docs/program/wanxing-independence.md` 停在 10-04 且自相矛盾（L29 修订「跨进程上报保留」vs L36-37 仍写「迁入后改同进程直写」），其后 35 个归档 change 零回写；CONTEXT.md 语言表停在 10-22。另有 `openspec/specs/copilot-intent-adherence/` 整目录从未 git add（唯一无版本记录的 spec），以及过期代码头注（fleet-report.js:3-4、store.js:3-4）描述一次不会发生的替换。

## What Changes

- README「本仓现在有什么」表重写：facade/observer/web 全部改为现址现态，标注 runner 仍在 paas。
- `docs/program/wanxing-independence.md` 补「切片⑤之后的演进」一节，消除 L29/L36-37 矛盾；**记录用户 2026-11-06 裁决：agent-runner 正式按借用契约**（与 registry/packs/sub2api 同列，env 可重指，迁移如需要另立专项），不作为「待迁入」悬挂。
- 新 spec `wanxing-borrowed-contracts`：四条借用边界（registry/packs/sub2api/agent-runner）各一条需求——只经 HTTP+env、无库直连、env 双名兼容清单。
- `git add openspec/specs/copilot-intent-adherence/` 入库（一分钟坏账）。
- CONTEXT.md 语言表补 10-22 之后新词（记忆可见页/访客事项/套餐/机位/集群等）。
- 过期头注修正：`services/wanxing-facade/fleet-report.js:3-4`、`services/wanxing-facade/store.js:3-4`、`wanxing-web.yaml:3`（fd-infra-deploy，注释与 nginx 实际路由相反）。
- 悬空引用清理：Dockerfile:13 与 images.yml:2 的 `docs/IMAGE-RELEASE.md`（paas 仓文档）改指真路径；DocsView 注释声称的 `docs/wanxing-serving-api.md` 补进本仓或改引。

## Capabilities

### New Capabilities

- `wanxing-borrowed-contracts` — 借用边界契约化：四条外部依赖只经 HTTP+env 可重指。

### Modified Capabilities

（无——文档与注释对齐不改行为）

## Non-goals

- 不改任何运行时行为。
- 不动 paas 侧 spec（wanxing-facade twin 的 moved 标记属 unify-wanxing-a2a-face）。
- 不做全量文档美学重写，只对齐事实。

## Impact

- README.md、docs/program/、CONTEXT.md、两处服务头注、fd-infra-deploy 一处注释、Dockerfile/images.yml 引用路径。
- openspec/specs/copilot-intent-adherence/ 首次入 git。
- 下游：unify-wanxing-a2a-face 执行时引用本文档裁决，不再需要重述背景。
