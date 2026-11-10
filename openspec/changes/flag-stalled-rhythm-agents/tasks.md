## 1. 派生（health.js）

- [x] 1.1 新增 `parseRhythmMs(effectiveRhythm)`：认 `[{every:"<n><m|h|d>"}]` 首元素，返回 ms；空/缺/异形一律 `null`；单测覆盖 `1h`/`30m`/`2d`/`[]`/`null`/`"1h"`（裸字符串）/`[{cron:"..."}]` 七种输入
- [x] 1.2 `deriveHealth` 增 `rhythmMs` 入参，`silent` 分支返回 `declared_every_ms` / `expected_turns` / `stalled`；`expected = Math.floor(windowMs / rhythmMs)`（向下取整）
- [x] 1.3 门槛：`stalled = rhythmMs != null && expected >= STALL_MIN_EXPECTED && turns === 0`，`STALL_MIN_EXPECTED` 默认 3 且 env 可调（`FLEET_STALL_MIN_EXPECTED`）
- [x] 1.4 反例三条：无节奏 ⇒ `expected_turns: null` 且 `stalled: false`；`every:12h`+24h 窗（expected=2 < 3）⇒ 不判；`paused` ⇒ `paused` 且无 stalled 字段
- [x] 1.5 `ok/degraded/failing` 分支断言**不带**这三个字段（只在 silent 分支出现）

## 2. 接入（observer.js）

- [x] 2.1 新增 `slugFromPath(p)`（observer.js，与 facade `slugFor` 逐字同规则）；单测用真实 path 断言等于 rollup 里的 slug —— **这一步抓到了我自己的错**：我原以为 `_` 会被转成 `-`，实际 `_` 在允许字符集内、生产 slug 就是 `packs-4fhjskpibrr2d0_9bxacqq-wx-alpha`。测试期望值已按生产真值改正
- [x] 2.2 `evaluateHealth()` 从 `bookkeeper?.knownSet()` 取 `entry.metadata.effective_rhythm`，按 `slugFromPath` 建 `rhythmByAgent`；bookkeeper 为 null 或未就绪 ⇒ 空 Map（退化为无节奏）
- [x] 2.3 端到端断言：造一个「有 1h 节奏 + 窗口零回合」的 agent ⇒ board 的 `agent_health` 里出现 `silent` + `stalled: true` + `expected_turns: 24`

## 3. 渲染（wanxing-web）

- [x] 3.1 `HealthBadge` 增 `stalled` 分支：文案「该跑没跑 · 按声明每 N 应有 M 次」；无节奏的 `silent` 文案**逐字不变**（回归断言字符串相等）
- [x] 3.2 排序：`failing > degraded > stalled > silent > paused > ok`（`healthRank` 增一档），验证同屏两者时 stalled 在前
- [x] 3.3 旧 observer（字段缺席）不崩：mock 掉 `expected_turns`/`stalled` 断言按旧文案渲染

## 4. 收口

- [ ] 4.1 `openspec validate flag-stalled-rhythm-agents --strict` 通过；facade / web 两套测试全绿
- [ ] 4.2 上产后核对：`wx-alpha`（1h 节奏、已暂停）恢复后若仍无回合，应在窗口内被标 `stalled` 而不是平淡的「无流量」；记录一次真实样本后归档
