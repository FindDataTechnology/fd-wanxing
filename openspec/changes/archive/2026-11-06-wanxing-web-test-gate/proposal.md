# wanxing-web 测试与出片闸门（wanxing-web-test-gate）

## Why

wanxing-web 6,072 行前端零测试，CI（`.github/workflows/images.yml`）只出镜像不跑任何测试；后端 7,405 行测试养成的纪律没有罩住痛感最高的那半边——近一个月 fix 提交近半是「渲染崩溃/黑屏，真机走查抓的」（FleetView.jsx 6 连修、ChatView.jsx 4 连修、2a2644d/74ee780/4df9b53）。无真实用户意味着没有外部报错渠道，测试闸是唯一防线。

## What Changes

- wanxing-web 增加最小测试层：node:test（与根仓零框架依赖一致）覆盖纯逻辑层（auth.js/embed-auth.js/api 客户端/状态归约），+ 组件冒烟（关键视图 FleetView/CatalogView/ChatView 可渲染不崩，含已知三起崩溃的回归用例）。
- `wanxing-web/package.json` 增加 `test` script；根仓 `images.yml` 在出镜像前先跑根仓 `npm test` 与 web 测试，失败即不出片。
- 测试不追覆盖率指标，只追「真机才抓到的那类崩溃」有回归位。

## Capabilities

### New Capabilities

- `wanxing-release-gate` — 萬星出片质量门：测试先行、失败不出片、镜像可溯源。

### Modified Capabilities

（无）

## Non-goals

- 不做 E2E 框架选型/浏览器自动化（后续需要另立）。
- 不给既有后端测试补覆盖率，只把 `npm test` 接进 CI。
- 不动镜像构建线本身（hkccr→relay→ccr 拓扑不变）。

## Impact

- `wanxing-web/package.json`、新增 `wanxing-web/test/`、`.github/workflows/images.yml`。
- CI 时长略增（node:test 本地跑 <30s 量级）。
- 下游：本战役后续前端改动（wanxing-first-visitor）落在有闸门的流水线上。
