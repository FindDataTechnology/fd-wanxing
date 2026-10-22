## Why

部署者在萬星 console 能管理 pack 的部署、消耗与套餐，却看不到 agent 学到了什么——L2 记忆（fact / experience）已在上产蒸馏（fd-memory add-memory-distiller + v2.1），但可见性面（`GET /memory` / `POST /forget`）只有 owner-root person 车道，部署记忆（`d/<packId>` 根）无部署者可达入口。paas 侧姊妹 change `add-facade-memory-read-lane` 已规划平台缝带 rootKey 车道（platform 令牌 + 显式 rootKey，与 /admin/report 同信任级）；本刀在 console 侧消费它，把「我的 agent 记住了什么、忘了什么」变成部署者可操作的面。

## What Changes

- **facade 记忆代理端点**：部署者鉴权下，`GET /api/memory`（query：packId、scope、layer、since/until、分页）→ 以 fd-memory platform 令牌 + `rootKey=d-<packId>` 转发 `GET /memory`；`POST /api/memory/forget`（packId、path、confirm）→ 转发 `/forget?rootKey=`。packId 归属校验：以部署者自己的部署清单为白名单（registry 侧既有 ownerGate 数据源），非自己 pack 404。
- **console 记忆页**：部署详情/列表进入「记忆」tab——按层（L0 观测 / L1 交接 / L2 事实与经验）与 project 筛选、时间线展示（标题、layer 徽章、sources、时间），L2 条目可展开正文；行级「遗忘」按钮带二次确认（confirm 语义）。
- **降级**：fd-memory 不可达时显式错误态（不空列表冒充无记忆）；车道未开（paas 侧未上产）时入口隐藏。
- **明确不做**：写车道（forget 之外）、跨部署者可见性、观测原文回放（L0 只列摘要）。

## Capabilities

### New Capabilities

- `wanxing-web` 增：部署者记忆可见页（层/project/时间筛选、L2 展开、行级 forget 带确认、降级显性）。

### Modified Capabilities

（无——facade 侧新端点归 `wanxing-facade` 的新增需求，proposal 细化时定）

## Impact

- facade：`services/wanxing-facade` 新路由 + env（FD_MEMORY_URL / FD_MEMORY_PLATFORM_TOKEN，secret `fd-memory-platform` 注入）。
- web：console 新 tab + API client；复用既有 table/Pager/错误边界组件（消耗表可读性战役的既有件）。
- 依赖：paas `add-facade-memory-read-lane` 上产（rootKey 车道）；本提案先立牌手，其 apply 排在 paas 车道之后。
