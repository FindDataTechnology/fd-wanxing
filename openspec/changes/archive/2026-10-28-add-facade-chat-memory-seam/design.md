# Design: facade 1:1 会话记忆读缝

## Decisions

### D1 注入的是提问访客本人的 owner 根
与母仓 D7 一致：`u/<visitor.email>`、`project=default`——person 令牌的 MCP 写入正是落在这里，所以读面=写面。不注入部署的 `d-<packId>`：那是 agent 的工作记忆，混进访客回合会让 agent 以为自己有过未发生的经历。

### D2 复用既有凭据，不新增 secret
本部署早前接 visibility 控制台时已带 `FD_MEMORY_URL` / `FD_MEMORY_PLATFORM_TOKEN`（同一 secret `fd-memory-platform`）。接缝同时认 `CELL_MEMORY_*` 与 `FD_MEMORY_*` 两种拼法，避免同一令牌在部署里存两份、也避免为这个功能再加一条 secret。

### D3 身份门只看 tier
`verifyVisitor` 已给两档：`tenant`（登录，带 email）与 `anon`（匿名，无 email）。注入与否只看 `tier === "anon"`，不引入新判断。匿名零请求——不是「注入了空块」，是根本不发请求。

### D4 降级开 + 一条开关
任何失败（mint 失败、digest 非 2xx、5s 超时、JSON 异常）都返回空串并 warn 一次，回合按原文发出。总开关 `WANXING_FACADE_MEMORY_DIGEST=0` 与母仓 chat 车道同义（整条静默、零请求）。

## Risks / Trade-offs

- **回合延迟**：每次登录回合多一次 digest 读（上限 5s）。实测生产在 1s 量级，且失败即原文。
- **令牌缓存粘滞**：person 令牌按邮箱缓存在进程内；fd-memory 侧令牌吊销后要等进程重启才刷新。可接受——令牌是长期 person 令牌，吊销不是常规操作。
- **mint 失败不缓存**：与令牌成功缓存相反，失败不写缓存，下一回合重试，避免一次抖动让整进程长期失明。
