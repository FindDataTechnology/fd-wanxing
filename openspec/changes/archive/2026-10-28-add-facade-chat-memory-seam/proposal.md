# Proposal: 1:1 会话接入 fd-memory digest 读缝

## Why

母仓 paas 的 `add-unified-memory-and-outputs` 设计 D7 定了「facade/智语走 chat-memory 同一条缝，不分不帕；登入=本 owner，游客=不注入」。智语房间那半边已随 paas 上线；facade 的 1:1 会话面（访客与某个已发布 agent 的对话）一直没有任何记忆读取——同样一个用户，在壹座 chat 里 agent 知道他的沉淀，在这里却是陌生人。这是 4.3 的最后一格。

## What Changes

- 新增 `services/wanxing-facade/memory.js`：读 fd-memory `/digest`（`project=default`、`q=`用户原话、`k=5`/`budget=1500`，与壹座 chat 同参），person 令牌经 `/admin/mint` 铸 `u/<email>` 并进程内按邮箱缓存；5s 超时；任何失败返回空串。
- `services/wanxing-facade/chat.js`：回合文本发出前注入——`tier=tenant` 的登录访客用本人 owner 的块；`tier=anon` 恒不注入且零记忆请求；`message/send` 与 `message/stream` 两路同源。
- 环境：复用该部署既有的 `FD_MEMORY_URL` / `FD_MEMORY_PLATFORM_TOKEN`（visibility 控制台的同一 secret，接缝兼容 `CELL_MEMORY_*` 拼法），不新增第二份令牌；新增 `WANXING_FACADE_MEMORY_DIGEST`（`"0"`=关，免换镜像回滚）。

## Non-Goals

- 不做跨 agent/跨租户共享记忆；不把部署的 `d-<packId>` 工作记忆注入访客回合。
- 不改结算/额度语义：记忆读取不计分钟、不进 usage 行。
- 不引入新的身份管道（沿用 `verifyVisitor` 的 tenant/anon 两档）。

## Impact

- 受影响能力：`wanxing-facade`（ADDED 一条需求）。
- 默认行为：部署配了凭据即生效；未配或 `WANXING_FACADE_MEMORY_DIGEST=0` 时回合字节级不变。
- 成本：登录访客每回合多一次 fd-memory 读 + 至多 1500 token 上下文。
