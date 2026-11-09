# 设计：区分「没人用」与「该跑没跑」

## Context

见 proposal.md 的 Why。设计必须容纳的既有事实：

- `health.js` 的 `deriveHealth({rows, paused, cause, failingMinConsecutive, degradedErrorRate})`
  只看 rollup 行 + 暂停标志，**不看 registry**；`silent` 在 `turns === 0` 时直接返回。
- `observer.js` 的 bookkeeper 每 `pollIntervalMs` 拉一次 `/api/agents?limit=500`，把整条
  registry entry 存在 `knownSet()`（`Map<path, {entry, paused, identity}>`）——**`entry.metadata.effective_rhythm`
  已经在那里**，不需要新请求。
- rollup 的 agent 名是 **slug**（`packs-4fhjskpibrr2d0_9bxacqq-wx-alpha`），bookkeeper 的键是
  **path**（`/packs/4FHjSKpibRr2d0_9BXaCqQ/wx-alpha`）。两者需要映射，规则与 facade 的
  `slugFor` 一致：去前导斜杠、非 `[A-Za-z0-9._-]` 转 `-`、转小写。
- 暂停态目前来自 `paused`/`resumed` 事件（`evaluateHealth` 里构建的 `pausedByAgent`），
  不是 registry——本 change 不改这一点。

## Goals / Non-Goals

**Goals**
- 有节奏声明的 agent 静默时，面板说得出「按声明应有 M 次，实际 0 次」。
- 无节奏的 agent 保持今天的「无流量」，一个字段都不多。
- 不改五态、不改 runner 行为。

**Non-Goals**
- 不预测下次触发时刻，不做调度推断。
- 不因为 `stalled` 触发任何自动处置（不重启、不重部署）。

## Decisions

### D1 `stalled` 是 `silent` 的注解，不是第六个状态

`state` 仍是 `ok/degraded/silent/paused/failing`；`silent` 时额外带
`declared_every_ms` / `expected_turns` / `stalled`。

**为什么**：五态已经被 spec 定死、被 UI 与测试消费。加状态要改所有分支和所有断言，
而"零回合"这件事本身没有变化——变的只是我们**对它知道多少**。

**备选**：新增 `stalled` 状态。否决：会让"是否零回合"这个判断在两个地方出现。

### D2 `expected_turns` 用窗口除间隔，向下取整，且要有门槛

```js
const everyMs = parseRhythmMs(entry.metadata?.effective_rhythm); // 认不得 ⇒ null
const expected = everyMs ? Math.floor(windowMs / everyMs) : null;
const stalled = Boolean(everyMs) && expected >= STALL_MIN_EXPECTED && turns === 0;
```

`STALL_MIN_EXPECTED` 默认 3（独立常量，env `FLEET_STALL_MIN_EXPECTED`）。

**为什么门槛**：`every: 1h` + 24h 窗口 ⇒ 24 次，远超门槛；而 `every: 12h` 在 24h 窗口里
只有 2 次，零回合也可能是刚部署，判 stalled 会制造噪音。3 是"我至少错过了三次"的意思。

**为什么向下取整**：向上取整会在窗口刚好等于一个间隔时把 1 算成 2，夸大预期。

### D3 节奏解析失败一律当「无节奏」

`effective_rhythm` 的形状：实测是 `[{"every":"1h"}]`。解析只认这个形状（数组首元素的
`every` 为 `<n><unit>`，unit ∈ m/h/d）。其它形状、空数组、缺字段 ⇒ `null` ⇒ `stalled: false`。

**为什么**：宁可漏报，不可误报——误报会让"该跑没跑"这个信号失去信任，而它存在的全部意义
就是可信。

### D4 映射 path→slug 用同一个函数，别各写一遍

在 observer 里加一个 `slugFromPath(p)`，与 facade `console.js` 的规则逐字一致；并加一条
测试：对 registry 里真实的 path 形态（大写、下划线、带 `_` 的 packId）断言产出与 rollup 行的
agent 名一致。

**为什么**：这是本轮反复出现的坑——两处各写一遍大小写/分隔符处理，就会有一批 agent 永远
匹配不上，而失配的表现是"静默地没有 stalled"，看不出来。

### D5 只在 `silent` 分支计算，`ok/degraded/failing` 不带这些字段

有回合的 agent 不需要"预期"来解释任何事。字段只在需要它的分支出现，避免消费方误读。

## Risks / Trade-offs

- [声明节奏与实际驱动不一致 → 误报] → 门槛 3 次；`stalled` 只影响文案与排序，不触发任何动作；
  且文案写"按声明"，把责任落在声明上。
- [path→slug 映射漂移] → D4 的对照测试；映射函数只此一处。
- [bookkeeper 未就绪（registry 不可达）→ 拿不到 rhythm] → 当"无节奏"处理（`stalled: false`），
  退化为今天的 `silent`；不阻塞、不误报。
- [窗口与节奏单位不一致] → 全部折算成 ms 再除，不按"小时数"心算。

## 迁移计划

1. `health.js` 纯函数增字段 + 单测（含"无节奏不判、门槛不足不判、暂停不判"三条反例）。
2. observer 接入 bookkeeper 快照 + `slugFromPath` 对照测试。
3. UI 文案与排序；`silent` 无节奏的渲染必须逐字不变（回归断言）。

**回滚**：字段是纯增量；UI 回退即恢复"无流量"文案；无需数据迁移。

## Open Questions

- `effective_rhythm` 是否还有其它形态（例如 cron 表达式）在别的线里在用？实施时以
  `/api/agents` 的真实样本为准：若发现有 `cron` 形态，先按 D3 当"无节奏"，另开单支持。
