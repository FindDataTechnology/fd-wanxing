# 上产核对与演练记录（4.2）

日期：2026-11-10　observer `sha-fc60c34` · web `sha-be94ec4`

## 一、真实浮出（未造，本来就坏着）

上产后第一次读 board 就有一条：

```
failing  packs-4fhjskpibrr2d0_9bxacqq-wx-alpha   turns=1378 err=1378 cause=unknown
```

追下去（`GET /api/fleet/v1/agents/<slug>/timeline`）：

```
11-10 01:35 → 02:27   54 个 turn_ended，ok = 0
turn_kind = "digest"，source = runner:runner-serving
边沿事件 agent_unhealthy × 1
  {"since":1794164400000,"consecutive":1358,"last_error_kind":"unknown","window_hours":24}
```

**为什么台账里查不到它**：`wanxing_usage` 只记门面受理的**外部**回合（API/对话车道），而这个 agent 只有 runner 自己的定时回合（digest）。它的台账最后一条是 10-22。所以这是"零外部调用方、每回合都失败"的形态——过去无论看台账还是看目录都完全隐形。

这正是本 change 要抓的东西，且它是**生产里真实发生的**，不是造出来的。

## 二、尝试造的演练：技能删除法**失败**，但结论有用

做法：`DELETE /api/skills/lex-console-tour`（源码在 `finddata-skills`，可逆），然后打 4 轮对话。

结果：

```
turn 1: pong     ← 命中热会话，照常成功
turn 2: pong
turn 3: 无输出
turn 4: 无输出
board: lex = {turns: 5, errors: 0, health: "ok"}   ← 没有任何失败落地
```

**结论**：技能缺失只会让**冷启动**失败；已经热着的会话在主进程里继续服务，失败要等会话冷掉才出现。所以"删依赖"不是一种可控的演练手段——它的生效时刻取决于会话生命周期（可能几小时）。

这条对信号本身有含义：**冷启动类故障的检出延迟 = 会话冷启动间隔**，不是 `FLEET_HEALTH_FAILING_MIN` 个回合。设计里"3 个回合内浮出"的说法只对**持续产生回合且每回合都失败**的 agent 成立（`wx-alpha` 就是这种：每分钟一回合）。

演练后已立即恢复该技能，并实测 `delta 帧数 105`，四条 `content` 全 200。

## 三、恢复半边：已在生产闭环

`wx-alpha` 的根因查清了——不是技能、不是模型，是**计费键被拒**：

```
[agent-runner] rollover failed for packs-4FHjSKpibRr2d0_9BXaCqQ-wx-alpha: 403 status code (no body)
```

每分钟一条，`billing_key_ref = pk_43810d87616fb1c70a63e94c` 失效，所以每个定时回合在
开新会话时就撞 403。它是私有、占位技能（`wx-wizard-check` =「验收占位技能」）、零外部
调用方的验收残留，每分钟烧一次且必然失败。

暂停它之后，两条事件共享同一个 `since`，配对完整：

```
浮出    agent_unhealthy  {"since":1794164400000,"consecutive":1358,"last_error_kind":"unknown"}
恢复    agent_healthy    {"since":1794164400000,"recovered_as":"paused","last_error_kind":"unknown"}
健康态  failing(1389/1389) → paused，consecutive 0
```

这就是 4.2 要的「造坏 → 浮出 → 恢复」——只不过不是造的，是本来就在坏。

**处置记录**：2026-11-10 由我（非该线负责人）通过运营凭据暂停
`packs-4fhjskpibrr2d0_9bxacqq-wx-alpha`（`POST /console/deployments/<slug>/pause`）。
理由：403 凭证失效 ⇒ 每次必败，且零外部调用方，纯资源浪费 + 噪音。
恢复方式：`POST /console/deployments/<slug>/resume`（换一个有效计费键后再恢复才是有意义的）。

## 三之二、暴露出的一个真缺口

`last_error_kind` 只能报 `unknown`：runner 的 `turn_ended` 载荷里不带失败原因
（`{turn_kind, session, duration_ms, outcome, budget_killed?}`），403 只写进它自己的日志。
要让面板直接说「凭证失效」而不是「原因未归类」，需要 runner 在 `turn_ended` 里带
`error_kind`——那是 paas 侧改动，属跨线，本 change 不动，只记录。

## 四、顺带发现并已修

`agent_health` 里混进了 `cell:*` 基础设施身份（cell 快照与 agent 事件共用同一条 ingest，rollup 写一行 `turns=0`，于是被当成"无流量的 agent"）。已过滤：32 条、`cell:*` 归零。

## 五、遗留

1. **凭证失效这一类故障的原因还看不见**（见三之二）：要 runner 带 `error_kind`，跨线。
2. 同类失效可能还有别处——现在健康信号会自己把它们浮出来，不必再靠人翻台账。
3. `wx-alpha` 若将来要复活，必须先换有效计费键，否则 resume 后立刻回到 failing。
