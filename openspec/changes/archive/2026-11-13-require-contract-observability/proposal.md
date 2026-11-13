# require-contract-observability

## Why

`wanxing-borrowed-contracts` 已经钉住了契约的一个方向：**发出去的键必须都在契约里具名**
（`contract.coverage()`，见「公开面发出的每个字段都必须在契约里具名」）。另一个方向一直是空的：
**契约里具名的键，必须真的能被发端观测到。**

2026-11-13 实测，这个空方向已经养出了两句假话，而且两句都在产线上：

| 声明（rev 1） | 发端实际发的 | 症状 |
|---|---|---|
| `runner_liveness[*] = {state, seen_at}` | `{last_seen_at, age_ms, beats, presence}` | 按契约读的人拿不到任何一个真键 |
| `agent_health[*] = {stalled, silent_ms, reason}` | `{since, consecutive, consecutiveHours, turns, errors, lastErrorKind, stale, window_hours}` | 同上；`health`/`agent` 之外全是错的 |

这两句假话撑了很久没被发现，原因不是判据不够严，而是**判据只看一个方向**：消费者按契约取
`state` 拿到 `undefined`，路由不报错、类型不报错、JSON Schema 也不报错（它只校验出现的键）。
写契约的人照着上一版抄了一层内层对象，抄错了，没有任何东西会红。

`scripts/test-board-contract-shape.mjs` 补上了这个方向：它起一个**真的** observer（真 sqlite、
真路由），喂进回合/心跳/租约/结算，然后把三个面的「声明键集」与「实发键集」双向比对，
并允许一份显式的条件键豁免表（只有声明了节奏的 agent 才有 `declared_every_ms` 这类）。

## What Changes

- 新增一条 requirement：契约的每个声明键 SHALL 有一个能观测到它的判据；纯条件键 MUST 进
  显式豁免表，不得靠"这次没出现"蒙过去。
- 判据已落在 `scripts/test-board-contract-shape.mjs`，由 `npm test` 的 `scripts/test-*.mjs`
  通配自动覆盖。
- 契约 rev 2 已按发端源码订正（`runner_liveness` / `agent_health` 两处内层键）。

## Impact

- 受影响能力：`wanxing-borrowed-contracts`（新增一条 requirement，不改既有条目）。
- 受影响仓：`fd-wanxing`（契约 + 判据）；`wanxing-ops-mcp`（字段集常量已同步到 rev 2）；
  `paas`（vendored 契约已同步 rev 2，消费者钉住的字面量已随升号改写）。
- 不改变任何运行时行为：契约是描述，判据是测试。
