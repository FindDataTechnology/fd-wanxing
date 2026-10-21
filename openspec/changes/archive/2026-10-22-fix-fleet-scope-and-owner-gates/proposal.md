# fix-fleet-scope-and-owner-gates

## Why

「我的舰队」把台账里**全部**部署列给任何登录身份且不标归属；非本人卡片的管理动作被
`ownerGate` 403 后，前端把错误写进永不打开的面板——体感是「按钮点了没反应」。同时
pause/resume 与允许清单增删**没有**归属校验：任何登录用户可暂停他人部署、改他人白名单。
2026-10-22 生产真机实证（aloadtree 身份）：8 张卡仅 2 张本人部署，配置/记录/额度/嵌入
全 403 静默，允许清单对他人卡返回 200 可增删，暂停同无校验。

## What Changes

- **部署列表按身份过滤**：登录身份只见 `deployedBy` 为本人的部署；ops 令牌仍见全部
  （运维面行为不变）。
- **管理动作归属闸补齐**：pause/resume 与允许清单增删复用 `ownerGate`
  （deployer-or-ops），与 usage / host-allowance / embed-settings / config 代理同一语义。
- **拒绝显性化（web）**：管理面板加载失败时，错误反馈渲染在卡片旁可见处（不得只写进
  未打开的面板状态），403 给「非本人部署」类文案而非「请稍后再试」。

## Capabilities

### New Capabilities
- `fleet-ownership-gates`: 舰队面归属语义——谁能看见哪些部署卡、谁能对谁的部署执行管理
  动作（暂停/允许清单/记录/额度/嵌入/配置）、动作被拒时 web 必须可见反馈。

### Modified Capabilities

（无——姊妹 change `add-cluster-*` 与 `harden-copilot-intent-envelope` 在途且已占
`wanxing-facade` / `wanxing-web` 的 delta，本 change ADDED-only 规避归档排序死锁。）

## Impact

- `services/wanxing-facade/console.js`：`/console/deployments` 过滤、`pauseAction` 与
  callers 增删补 `ownerGate`。
- `wanxing-web/src/views/console/FleetView.jsx`：错误文案渲染位置与分型。
- 行为变更（对越权路径即 BREAKING）：原先 200 的越权 pause/允许清单操作将 403；
  普通登录身份的部署列表从「全平台」缩到「本人」。

## Non-goals

- 「我的套餐」卡改名/挪位、部署向导文案与步骤重排（产品层议题，另立 change）。
- packs 侧 config 代理的归属校验不动（已正确）。
- ops 令牌视角的任何收敛或新增。
