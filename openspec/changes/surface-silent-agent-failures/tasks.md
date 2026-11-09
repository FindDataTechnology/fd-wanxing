## 1. 派生健康态（observer）

- [x] 1.1 新增 `services/fleet-observer/health.js`：纯函数 `deriveHealth(rollupRows, { paused, windowHours, failingMinConsecutive, degradedErrorRate })` 返回 `ok|degraded|silent|paused|failing` + `{since, consecutive, lastErrorKind}`；单测覆盖五态各一例，验证 `silent` 与 `failing` 在"零回合"与"全部失败"上互斥
- [x] 1.2 阈值走独立 env（`FLEET_HEALTH_WINDOW_HOURS=24`、`FLEET_HEALTH_FAILING_MIN=3`、`FLEET_HEALTH_DEGRADED_RATE=0.30`），验证改任一值立即生效且不随 rollup 周期变化
- [x] 1.3 暂停豁免：从 registry 条目读 `metadata.paused` 并优先判定为 `paused`；registry 不可达时该 agent 本轮跳过并标 `stale`（不判 ok）；单测覆盖"暂停 + 全失败 → paused"与"registry 超时 → stale"
- [x] 1.4 失败归类：从最近失败回合的事件载荷推导 `cold_start|upstream|rate_limited|budget|unknown`；`ok` 时字段为 `null`；单测断言 `unknown` 与 `null` 不可混
- [x] 1.5 回测用例：用 2026-10-22→11-10 的真实样本（识律控制台伴随助手，100% 失败）断言判 `failing`，同窗口内正常 agent 判 `ok`（零误报）

## 2. 暴露面（board）

- [x] 2.1 `/api/fleet/v1/board` 增 `agent_health: [{agent, health, since, consecutive, last_error_kind, window_hours}]`，按 `failing > degraded > silent > ok` 排序；断言既有字段（`agents_total`/`turns`/`errors`）逐字不变
- [x] 2.2 边沿事件：跃迁写入 `agent_unhealthy` / `agent_healthy` 各一次，载荷 `{agent, since, consecutive, last_error_kind, window_hours}`；单测覆盖"跨入发一次 / 持续不发 / 恢复配对"
- [x] 2.3 已实测：ingest 在 `observer.js:74` 用 `EVENT_KINDS.includes` 校验，未知 kind **直接 400 拒收**——所以两个新 kind 已加进 `store.js` 的 `EVENT_KINDS`，与出片同批。原任务「先确认未知 event kind 在既有主干是落库还是丢弃（`kindSince` 的未知 kind 行为）；若丢弃，事件 kind 与 observer 版本同批上线并在 tasks 里记录

## 3. 控制台渲染

- [ ] 3.1 FleetView 每张部署卡带健康徽标；`failing` 排到该分组最前，显示持续时长与原因；`silent` 标"无流量"而不是健康；`paused` 标"已暂停"；验证三种态在 mock 数据下渲染正确且不出现 `undefined`
- [ ] 3.2 健康段缺失/不可达时整段不渲染（不假装健康）；用删除 board 字段的 mock 验证页面不崩、无假绿
- [ ] 3.3 OpsView 增「不健康 agent」清单（failing + degraded，含时长与原因、可跳到该 agent 视角）；空态显式写"当前无不健康 agent"

## 4. 收口

- [ ] 4.1 `openspec validate surface-silent-agent-failures --strict` 通过；测试三套全绿（facade / web / lex）
- [ ] 4.2 上产后核对：识律那条若再次坏掉，面板应在 `FLEET_HEALTH_FAILING_MIN` 个回合内把它排到最前；记录一次真实的"造坏 → 浮出 → 恢复"演练
