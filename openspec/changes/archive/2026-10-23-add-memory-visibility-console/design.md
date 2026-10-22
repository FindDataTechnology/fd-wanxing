# Design — add-memory-visibility-console

## Context

paas 侧 `add-facade-memory-read-lane` 已上产（`/memory`/`/forget` 平台缝 rootKey 车道，168/0 归档）。facade 侧 packId↔deployer 映射真源 = `bookkeeping.rows()`（`deployedBy`/`packId`/`agentPath`），per-slug 归属闸 = 既有 `ownerGate`（pause/resume/usage 同款）。web 端 FleetView 已有面板模式（按钮 → authFetch → 面板 + 状态分语错误横幅）。

## Decisions

### D1 facade：内存代理两路由，rootKey 从 verified row 派生

- `console.js` 新增 `GET /deployments/:slug/memory` 与 `POST /deployments/:slug/memory/forget`：ownerGate → `rootKey = "d-" + row.packId` → `memoryFetch("/memory?rootKey=…&layer=…")` / `("/forget", {path, confirm})`。
- `memoryFetch` 在 `routes.js` 装配：`FD_MEMORY_URL` + `FD_MEMORY_PLATFORM_TOKEN`（k8s secret `fd-memory-platform` 注入，与 fleet-observer 凭据装配同款——routes.js 已有 observerFetch 先例）；未配置 = 路由 503 `{error:{code:"MEMORY_LANE_UNCONFIGURED"}}`。
- 转发是**透明代理**（状态码与 body 原样透传，仅包 `{error:{code}}` 于本侧失败）——错误语义单一真源在 fd-memory。
- 忘记的确认参数必须由浏览器显式带上（两步确认在前端），facade 不代填。

### D2 web：FleetView 加「记忆」按钮 + MemoryPanel

- 面板状态模式与 usage 面板同款（`memory={slug,doc}`、`loadMemory(slug)`、错误横幅 403/503 分语）；layer 筛选 chips（L0/L1/L2/全部）+ 客户端搜索；L2 条目展开正文；行级遗忘两步确认（点遗忘 → 面板内确认条「确认遗忘 <title>？」→ confirm:true POST → 移除该行）。
- 车道未配置（503 MEMORY_LANE_UNCONFIGURED）→ 部署卡上「记忆」按钮直接隐藏（403/503 只有点了才见）。

### D3 测试

- facade：`scripts/test-wanxing-console.mjs` 增用例（owner 200 透传 / 非 owner 403 且零转发 / 未配置 503 / forget 无 confirm 400）。
- web：沿用既有 console 走查脚本模式（DOM 断言），UI 手工走查放验收。

## Risks / Trade-offs

- [platform 令牌落 facade] = 与 observer 凭据同级信任；审计在 fd-memory 侧（platform: tokenId）可追溯。
- [大分页拖慢面板] → limit 默认 50、layer 筛选在转发参数里（fd-memory 侧过滤）。

## Migration Plan

facade 与 web 同仓同车出片；fd-memory 无改动。回滚 = 回镜像（车道保留无害）。

## Open Questions

（无）
