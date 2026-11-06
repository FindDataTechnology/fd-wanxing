# 萬星 A2A 出面统一（unify-wanxing-a2a-face）

## Why

wanxing-facade 在 paas 侧存在双活 twin：paas `gateway/wanxing/` 仍服务 platform 域卡片，twin 修靠人肉双 commit（11-05 redaction 双仓各改一次、间隔 30 分钟）；fork 头注写「paas 标 moved」从未执行，两头不诚实。更重的是 **paas 10-12 fix-agent-serving-stability 的幂等指纹硬化（key-reuse 拒收/错误不重放/body 指纹绑定）fork 未回灌**——fd 侧 core.js 与 spec 均为硬化前旧文本，wanxing 域 reset-ticket 洞可能敞开。另 ops-mcp 4/8 工具（callers/pause/resume）焊在 paas 待拆路由上，facade 已有等价实现但编址不同（slug vs packId/agentId）。用户 2026-11-06 裁决：卡片面收归萬星统一出面，twin 终结。

## What Changes

**硬化回灌（先行，独立可验收）**
- paas core.js D1/D2 幂等硬化（IDEMPOTENCY_KEY_REUSE 结构化错误、request_hash 绑定、错误回合不重放）移植进 fd `services/wanxing-facade/core.js`；对应 4 场景需求并入 fd `wanxing-facade` spec。
- 用测试锁死：同 key 不同 body 拒、错误回合不重放、同 key 同 body 幂等返回。

**卡片面统一**
- 萬星 facade 成为唯一 A2A 卡片/目录出面；核实 platform 域卡片消费方清单（含 delegation 桥、wanxing-ops-mcp、存量调用方），逐一迁移或确认无消费。
- 解开 `gateway/index.js:861` zhiyu lane 对 `wanxing.bookkeeping` 的 import 级耦合（bookkeeping 抽独立模块或换数据源），随后 paas 摘挂 `gateway/wanxing/` 卡片路由。
- paas 侧 `openspec/specs/wanxing-facade/` 标 moved 指向本仓（twin commit 流程同步废止）；paas 独有需求（platform 域卡片 redaction）随摘挂并入本仓 spec 或随路由退役。

**ops-mcp 迁址**
- facade 落 packId/agentId 编址的管理路由（callers/pause/resume，复用 logtoAuth 门），兼容现有 slug 编址语义映射。
- `wanxing-ops-mcp` 的 `WANXING_OPS_BASE_URL` 切 `https://wanxing.finddatatech.cloud`（fd-infra-deploy 一行）；tool-surface 端点断言更新；补 `wanxing_fleet_board` 只读工具（吃 observer `/api/fleet/v1/board`）。
- 顺手接线 `sub2api selfCheck()` 进 facade /healthz 深探针（写好从未调用）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-facade` — 幂等硬化 4 场景、管理路由收编（packId/agentId 编址）、唯一 A2A 出面、healthz 深探针。

## Non-goals

- 不迁 agent-runner（已裁决按借用契约，见 wanxing-docs-truth）。
- 不动 paas 网关其余路由与 packs/deploy 域（host-allowance 结算等反向契约保留）。
- 不改 sub2api/registry 契约形状。
- platform 域域名不 301（存量消费方迁移完再议，属后续）。

## Impact

- fd-wanxing：`services/wanxing-facade/core.js`、`console.js`、`routes.js`、spec `wanxing-facade`；跨仓 paas（gateway/index.js、gateway/wanxing/ 摘挂、spec 标 moved）；`wanxing-ops-mcp`（base URL+工具面）；fd-infra-deploy（ops-mcp env）。
- 部署窗口：facade 先滚（硬化+管理路由），paas 后摘（顺序硬约束，摘早了断 ops-mcp 管理半边）。
- 风险：platform 域卡片消费方清单必须先核实再摘挂——任务里列为第一项前置。
