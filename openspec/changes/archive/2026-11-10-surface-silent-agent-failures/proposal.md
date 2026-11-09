# 让「坏掉的 agent」自己浮出来（surface-silent-agent-failures）

## Why

一个已部署的 agent 可以**连续 19 天每回合都失败而无人知晓**。2026-11-10 上产跨线副驾时才发现：「识律控制台伴随助手」自 10-22 起零成功回合，原因是它引用的四个技能被从 registry 删干净，冷启动每次 `-32004`。这 19 天里唯一的痕迹是回合台账里的 `outcome=error, minutes=0` —— 一行没有任何人看的记录。

现有的观测面知道「有多少回合、多少错误」，但**没有"持续性"这个维度**：`errors` 是一个窗口内的累计数，多一个错和一直错看起来一样。于是"偶发失败"和"这个 agent 已经废了"在面板上是同一个数字，后者永远不会自己跳出来。

这轮抓到的另一个结构性事实：失败的第一现场往往不在 agent 自己的日志里，而在**它依赖的东西**（registry 技能、pack 台账、计费面）。所以健康信号不能只看 turn outcome，还要带上失败原因。

## What Changes

**① 观测面派生健康态（不新增存储）**
- 从既有 `rollup_agent_hour` 读最近 N 小时，产出每个 agent 的 `health = ok | degraded | silent | failing`，附 `since`、`consecutive_failures`、`last_error_kind`。
- 判据（三态分离，避免上一轮踩过的"读不到当成不存在"）：
  - `silent`：窗口内 **零回合** —— 不知道好坏，不是健康，也不是故障；
  - `failing`：窗口内有回合且**全部失败**，且连续失败数 ≥ 独立常量 `FAILING_MIN_CONSECUTIVE`（不从轮询周期派生）；
  - `degraded`：有成功也有失败，失败率超阈值；
  - `ok`：其余。
- **暂停中的 agent 不计入 failing**（暂停是合法静止，不是故障）；判定需要 agent 的 paused 状态，从 registry 条目读。

**② 失败原因带上，别只报"错了"**
- `last_error_kind` 从既有事件载荷里取（冷启动 / 上游 / 限流 / 预算），没有就 `unknown` —— 明确区分"不知道"与"无错误"。
- 首次跨越阈值时发一条边沿事件 `agent_unhealthy`（**只在状态跃迁时发一次**，不是每回合发），供既有告警投递消费。

**③ 面板上看得见**
- 控制台舰队面：部署者能看到自己的 agent 带健康徽标；`failing` 的排在最前，点开显示 `since` 与原因。
- 运维面：全体 `failing` / `degraded` 的清单与持续时长。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fleet-observability`：新增 agent 派生健康态（四态、独立阈值、暂停豁免、错误归类）与 `agent_unhealthy` 边沿事件。
- `wanxing-web`：舰队面与运维面渲染健康徽标与排序；`failing` 给出可执行提示（去哪里看原因）。

## Non-goals

- **不做告警通道本身**。五线告警投递（邮件 DirectMail）已于 2026-11-08 接通；本 change 只负责产出边沿事件，投递沿用既有通道。
- 不做自动修复（不重启、不重新部署、不自动补技能）。信号先立起来，处置留给人。
- 不改 rollup 的粒度与保留窗（14 天），不做逐回合存储。
- 不覆盖"从未部署成功过"的 agent（那是发布门的事，不是运行时健康）。

## Impact

**代码**
- `services/fleet-observer/`：新派生模块（读 `rollup_agent_hour` + registry 暂停态）、`/api/fleet/v1/board` 增 `agent_health` 段、边沿事件写入。
- `wanxing-web/`：`FleetView` 健康徽标与排序、`OpsView` 全局清单。

**契约**
- board 响应**只增字段**，旧消费者不受影响（`agents_total` / `turns` / `errors` 语义不变）。
- 新增事件 kind `agent_unhealthy`：既有事件主干与 observer 的 kind 索引需接受它（未知 kind 当前是丢弃还是落库，实现时先确认）。

**风险**
- 阈值定太紧会制造噪音（一个正常 agent 偶发一两次失败就报警），定太松则回到看不见。用 10-22 到 11-10 这段真实数据当校准样本：那 19 天里该 agent 是 **100% 失败**，所以任何"全失败 + 连续 N"的判据都能抓到它；反倒是"失败率"型判据需要小心低流量 agent（1 次失败 = 100%）。
- 低流量是常态（本次扫描里 6 个 reception 部署有 4 个零回合），所以 `silent` 必须与 `failing` 严格分开，且不触发告警。
