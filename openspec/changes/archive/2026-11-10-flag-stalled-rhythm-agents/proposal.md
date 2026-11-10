# 区分「没人用」和「该跑没跑」（flag-stalled-rhythm-agents）

## Why

`surface-silent-agent-failures` 立了五态健康，其中 `silent`（窗口内零回合）是诚实的"无信息"。
但实测里它把两件完全不同的事压成了同一个显示：

- **没人用**：没有节奏声明的 agent，只在外部回合到来时才跑 —— 零回合是正常的；
- **该跑没跑**：声明了节奏（如 `effective_rhythm: [{"every":"1h"}]`）的 agent，零回合意味着
  **它坏了且没人知道**。

2026-11-10 的 `wx-alpha` 就是后者：它的 rhythm 是每小时一次，但滚版重启后
`rollover.check()` 只滚热着的子进程（`if (!this.manager.children.has(key)) continue;`），
于是它一次都不重试，时间线上只剩 `agent_unhealthy`、一个 turn 都没有。面板上它显示
「无流量」——**和"部署了没人用"长得一模一样**。

这就是本 change 要切开的那条线：**有声明节奏的 agent 静默，本身就是故障证据**。

## What Changes

**① `silent` 带上"本该有多少次"的参照**

健康条目在 `silent` 时增三个字段：
- `declared_every_ms`：声明节奏的间隔（来自 registry 条目的 `metadata.effective_rhythm`）；
- `expected_turns`：窗口内按该节奏应有几次；
- `stalled`：`expected_turns` 达到阈值而实际为 0 时为 true。

**不新增第六个状态**——`silent` 仍然是"零回合"，`stalled: true` 只是给它一个解释。
这样状态机不变，任何按五态写的消费方都不用改。

**② 只有"该有节奏"的 agent 才可能 stalled**

- 无 `effective_rhythm` ⇒ `expected_turns: null`、`stalled: false`（零回合是正常生活）；
- 有节奏且 `expected_turns < STALL_MIN_EXPECTED`（默认 3）⇒ 不判 stalled（刚部署、窗口短，
  证据不足，不制造噪音）；
- 暂停中的 agent ⇒ `paused`，不参与（暂停本来就该零回合）。

**③ 面板文案分开**

`silent` 且 `stalled` 的卡片/行写「**该跑没跑**：按声明每 N 应有 M 次，实际 0 次」，
并排在 `silent` 分区之首；无节奏的仍写「无流量」。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fleet-observability`：`silent` 携带声明节奏参照（`declared_every_ms`/`expected_turns`/`stalled`），
  以及判定的门槛与豁免。
- `wanxing-web`：舰队面与运维面区分「该跑没跑」与「无流量」。

## Non-goals

- **不改 runner 的重试行为**（`rollover` 只滚热子进程是刻意的：不为摘要冷启 N 个 agent）。
  本 change 只让这件事可见，不替它做决定。
- 不新增状态、不改五态语义。
- 不按节奏预测"下一次该什么时候跑"（不做时间表，只做窗口内计数）。
- 不对无节奏的 agent 做任何推断。

## Impact

**代码**
- `services/fleet-observer/health.js`：`deriveHealth` 增 `rhythm`/`expectedTurns` 入参与返回字段；
  `deriveFleetHealth` 透传。
- `services/fleet-observer/observer.js`：`evaluateHealth()` 从 bookkeeper 快照取
  `metadata.effective_rhythm`，按 path→slug（与 facade `slugFor` 同规则）映射到 rollup 的 agent 名。
- `wanxing-web`：`HealthBadge` 与 OpsView 行按 `stalled` 分文案。

**契约**
- board 的 `agent_health` 只增字段；既有字段与五态不变。

**风险**
- 节奏声明与实际节奏不一致（声明 1h 实际被外部回合驱动）会把正常 agent 判成 stalled。
  缓解：阈值 3 次；且 `stalled` 只是文案与排序提示，不进任何自动处置。
- `effective_rhythm` 形状可能多种（数组、`every` 字符串形式）。解析失败一律当"无节奏"，
  退化为今天的 `silent`。
