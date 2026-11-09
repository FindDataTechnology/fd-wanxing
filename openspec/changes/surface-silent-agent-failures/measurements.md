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

## 三、恢复半边：只在自动化里验过

`agent_healthy` 的配对（同一 `since`、且只在离开 `failing` 时发一次）由 `scripts/test-fleet-health-board.mjs` 的 "2.2" 覆盖。**生产里尚未观察到一次真实恢复**——唯一持续失败的 `wx-alpha` 至今仍失败（它是真的坏了），而我的受控造坏没落地失败。

## 四、顺带发现并已修

`agent_health` 里混进了 `cell:*` 基础设施身份（cell 快照与 agent 事件共用同一条 ingest，rollup 写一行 `turns=0`，于是被当成"无流量的 agent"）。已过滤：32 条、`cell:*` 归零。

## 五、待办

1. **`wx-alpha`（阿尔法哨兵）的处置**：它是验收占位 agent（唯一技能是「验收占位技能」，无 mcpServers、无外部调用方），每分钟一回合、每回合失败。暂停它会把健康态变成 `paused`（并触发一次 `agent_healthy` 恢复事件）——但那属于别人的部署，未经裁决不动。
2. 若要做完整的"恢复"生产证据，最干净的对象是它：暂停/修好之后应看到 `agent_healthy`。
