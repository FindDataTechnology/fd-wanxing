# add-mission-board

## Why

M2 ④：mission 生命周期事件（mission.*，facade 派发面已发）被 observer 的 kind 白名单整批拒收（生产实证 0 行落库）——观测断流；board 也无 mission 面。任务定义面上线后，运营在一屏看「目标→计划→成本→产物」是 M2 观测收尾。

## What Changes

- **ingest 白名单**收 `mission.submitted|planning|plan_ready|approved|scheduled|executing|reported|failed|aborted|exhausted`（沿 mission.* 前缀族；缺省拒收语义不变）。
- **board 面**：`/api/fleet/v1/board` 增 `missions` 段——最近 24h 的 mission 视图（id/owner/当前状态/状态轨迹/花费分钟），从原始流 bounded 窗口合成（mission 事件量天然小，不进 hour×agent rollup）。
- **console 渲染**：萬星 web 的 fleet 面板加「任务」小节（状态徽标+owner+spent），复用现有 board fetch。

## Capabilities

### Modified Capabilities

- `fleet-observability`: ingest 接受 mission.* 事件族；board 增加 missions 合成段。

## Impact

- 代码：`services/fleet-observer/store.js`（EVENT_KINDS）、`observer.js`（board missions 段）、`wanxing-web/ConsoleView.jsx`（渲染）；测试沿 test-fleet-observer 先例补两例。
- 不做：mission 的计划步骤细目/报告正文进 board（console 的任务详情面已有，board 只做一屏总览）。

## Non-goals

- 不改 rollup 面（mission 事件不进 hour×agent 聚合——粒度不匹配）。
