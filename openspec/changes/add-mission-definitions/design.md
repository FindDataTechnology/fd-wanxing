# design — add-mission-definitions

> 立项语境：roadmap M2 场景A 第一块（任务定义面）；planner 形态已定案 agent 路线。
> 本 change 交付数据与控制面；planner pack（②）、夜间车道（③）、board 视图（④）是后续 change。

## D1 存储：两张表，派生不计数

沿 serving-plans 的库风格（store.js 建表 + 迁移列 + 派生查询）：

```sql
CREATE TABLE wanxing_missions (
  id TEXT PRIMARY KEY,                -- msn_<hex12>
  owner_id INTEGER NOT NULL,          -- console 用户（sub2api 账号 id，沿 plans 的 owner 语义）
  owner_email TEXT NOT NULL,
  goal TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  window_start INTEGER NOT NULL,      -- epoch ms
  window_end INTEGER NOT NULL,
  cost_cap_minutes INTEGER NOT NULL,
  approval TEXT NOT NULL DEFAULT 'human',   -- human | auto
  status TEXT NOT NULL DEFAULT 'draft',
  plan_json TEXT,                     -- planner 回写的步骤数组（[{id,agent,target_model,when,prompt,depends_on}]）
  report_json TEXT,                   -- 最终报告（planner 回写）
  history_json TEXT NOT NULL DEFAULT '[]',  -- [{to,by,at,note}] —— 审计轨迹，无查询面
  dispatch_token TEXT,                -- 当前纪元回写凭据（见 D3）
  dispatch_token_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- 已花费分钟 = `SELECT SUM(minutes_billed) FROM wanxing_usage WHERE mission_id = ?`（含未结算行）——沿 plans/host-allowance 的「账本派生、绝不计数器」纪律。`wanxing_usage` 迁移加列 `mission_id TEXT`（ALTER 沿 channel/settler/plan_ref 先例；幂等建列）。
- 状态历史用行内 JSON 而非独立事件表：只有详情页消费，无聚合查询面；fleet 事件（D7）才是观测面。

## D2 状态机：一张转移表，一个执行函数

| from | to | 触发者 | 动作 |
|---|---|---|---|
| draft | submitted | owner | 触发派发（D3） |
| (非终态) | aborted | owner/ops | 拒绝后续派发与回写推进 |
| submitted | planning | 系统（派发受理） | — |
| planning | awaiting_approval | planner 回写 plan | approval=human |
| planning | auto_approved | planner 回写 plan | approval=auto |
| awaiting_approval | scheduled | owner/ops approve | — |
| auto_approved | scheduled | planner 回写「就绪」 | — |
| scheduled | executing | planner 回写首步开跑 | — |
| executing | reported / failed | planner 回写报告/失败 | 终态 |

实现为纯函数 `transition(mission, to, by)`：校验 (from,to,role) 合法 → 更新 status + append history → 发事件。所有入口（API/回写/派发）共用这一个函数，非法转移结构化拒绝——不存在第二处状态写点。planner 回写的步骤级进度（哪步 done）落在 plan_json 各步的 status 字段，不进状态机（状态机只管 mission 级）。

## D3 派发通道与纪元凭据

- **派发**：facade 以服务身份向 `MISSION_PLANNER_SLUG` 指向的部署 agent 发一回合 `message/send`（复用 a2a face 的 upstream 通道：`agentUrlFor(agentPath)` + `forwardHeaders()`；不占任何 caller 配额、不走 plan/chat 结算——这是服务内呼，usage 行以专用 service caller 记账或按部署键，**mission 维度照记**）。fire-and-forget：submit 请求受理即返回，派发失败重试 1 次，仍败 → mission failed（note=dispatch failed）。
- **brief**：四元组 + mission id + 回写端点 URL + 纪元凭据 + 协议说明（planner 技能正文消费；协议常量同源于 planner pack change ②）。
- **纪元凭据**：`randomBytes(24).hex`，存 dispatch_token；失效条件=mission 终态 or 下一次派发铸造新值。回写端点 `POST /api/wanxing/v1/missions/:id/writeback`，头 `X-Mission-Token`；body `{kind: plan|step|ready|report|fail, payload, idempotencyKey}`。同 (mission, idempotencyKey) 重放返回首次结果（落一行 writeback 记录表 `wanxing_mission_writebacks`，PK (mission_id, idem_key)——幂等即「插入冲突则回放原结果」）。回写不携带任何 caller/key 材料。
- **时间窗**：派发前置检查 `now ≤ window_end`；过期拒绝（409 MISSION_WINDOW_EXPIRED）。窗内执行节奏（夜里跑）是 planner 的 brief 约束（其 scheduling 技能自排），facade v1 不做步骤级窗调度——那是 change ③。

## D4 成本闸：facade-lane 记账，边界如实

- **记什么**：经 facade 派发的 mission 回合（planner 派发回合 + 未来 facade 代发的步骤回合）在 wanxing_usage 落 mission_id 列。
- **闸在哪**：派发入口前查派生已花费 ≥ cap → 402 MISSION_EXHAUSTED（沿 planGate 的 core.js 形状）；已开跑回合不中断。
- **边界（如实声明）**：planner 在 runner 侧自行委派的步骤回合（delegate→fleet agents）结算到各部署键，**不进 wanxing 账本、v1 不计入 mission cap**——它们的预算受各部署 C1 回合预算约束，全链 per-mission 对账（把 runner 侧计量也挂 mission 维度）留给 change ③ 夜间车道一并做。M2 出口的「成本对账」演示以 facade 账本 + sub2api 组用量两面拼图。
- 结算路径零改动：cap 是派发闸，不是结算器。

## D5 API 与 console 面

- `GET/POST /api/wanxing/v1/console/missions`（owner 列表/创建）
- `GET /api/wanxing/v1/console/missions/:id`（详情：四元组+plan+report+history+spent/cap）
- `POST .../missions/:id/submit|approve|abort`（approve 仅 awaiting_approval；abort 非终态）
- ops 门：`GET /api/wanxing/v1/console/missions/all` + abort（沿 serving-plans 的 opsOnly 先例）
- `POST /api/wanxing/v1/missions/:id/writeback`（纪元凭据门，见 D3；不走 console 会话）
- wanxing-web ConsoleView 新「我的任务」面板（data-testid missions-panel）：列表（状态徽标/四元组摘要/spent÷cap 进度）/详情（步骤+历史）/approve/abort 按钮；planner 未配置时 submit 按钮 disabled + 显式提示（MISSING_PLANNER 配置态，非静默）。
- env：`MISSION_PLANNER_SLUG`（缺省空=降级态）、`MISSION_SERVICE_SETTLER`（派发回合的记账归属，缺省沿部署键）。

## D6 观测：沿既有 report 通道

每次转移经 a2a face 的 `report({kind: "mission.<transition>", agent: planner slug, payload})` 发 fleet-observer；kind 全集 `mission.submitted|planning|plan_ready|approved|scheduled|executing|reported|failed|aborted|exhausted`。失败不阻塞转移（try/catch，note 即 best-effort——沿 a2a note 先例）。board 聚合视图不在本 change。

## D7 测试与验收

- `scripts/test-wanxing-missions.mjs`（node --test，沿 test-wanxing-plans 先例）：建库幂等/非法四元组/状态机全合法路径+三类非法转移/abort 优先级/纪元凭据铸造-失效-重放幂等/账本派生 spent/闸 402 与「不中断已跑回合」/过期窗拒绝/ops 面/降级态。
- e2e 手验脚本 `scripts/mission-walkthrough.mjs`：双 mission（human/auto）走全机 + cap 耗尽 402 + abort——planner 用假 stub（本地起一个应答 writeback 的最小 server，或 monkey-patch upstream）演示契约，真 planner 回合留 change ② 的验收。

## 风险与不做

- planner 派发回合的服务内呼记账归属（部署键 vs service caller）在实现时按 a2a face 最小改动面定，不引入新结算语义。
- history_json 无界增长：单 mission 转移数天然有限（<20），不设修剪。
- 并发：状态转移与凭据更新走单条 UPDATE ... WHERE status=? 乐观并发，冲突即非法转移。
