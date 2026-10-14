## Context

paas 仓 `unify-wanxing-management-plane`（萬星管理面统一，切片⑤）定案：管理=甲（runner 舰队）、
监控=统一只读——gateway 周期代采各 cell 的 `/api/tasks/stats`，以 `cell_stats` 事件
（`source: "cell-sampler"`、`agent: "cell:<userId>"`、payload 纯计数）投本 observer 的
`/ingest`。本仓收终点：白名单、board 段、console 渲染。

## Goals / Non-Goals

**Goals**：board 一屏同时回答常驻（runners/states/turns）与短期（cells/shortterm）两本账；
console 眼见。

**Non-Goals**：不做 cell 控制动作（通道天生单向）；不改 runners/states/missions 既有段；
不存 prompt 类用户内容（上游 payload 已是纯计数，observer 也不新增字段）。

## Decisions

### D1 cells 段=窗口内最新（与 runners 同构），shortterm=现算汇总

`kindSince(["cell_stats"], t-30min)` 倒序取每 agent 首条（freshest wins），照抄 runners 段
的既有模式——cell_stats 是周期采样不是事件流，聚合语义就是「最新水位」。`shortterm` 在同一
循环里对 payload 求和（`executions.running/queued`、`workers.busy/idle/cap`），防御式
`Number(x)||0`（老 gateway/异常 payload 不炸板）。

### D2 口径隔离：cell 不进 agents_total/states

`agents` Set 只收 turn/state/rollup 的常驻 agent。cell_stats 的 agent 键（`cell:<email>`）
若混入会把 states 分布撑出一堆 unknown——板子的常驻语义就此失真。隔离是显式决定，不是疏忽。

### D3 渲染降级开放（与 missions 段同款）

OpsView 对 `board.cells === undefined` 显示「暂无数据（observer 未升级）」；`shortterm` 同理
缺省 0。runners 行 `s.pod` 真→「pod 共宿」徽标，缺席不显示（旧 runner=solo 语义）。

## Risks / Trade-offs

- [cell_stats 量=cells×每 30s 一条] → kind-indexed 窗口查询有 idx_events_kind_ts；30 分钟窗
  上限=60×cells 行，量级无虞；保留策略 ride along 既有 retention。
- [上游 gateway 晚于本仓滚产] → 无数据时 cells 空对象+shortterm 零——诚实空态，不是错误。

## Migration Plan

本仓 observer+web 各自发布线滚产 → paas 侧出片滚产并配 FLEET_INGEST_URL/TOKEN → board
填充。回滚=任一侧回滚即可，互不锁死。

## Open Questions

（无）
