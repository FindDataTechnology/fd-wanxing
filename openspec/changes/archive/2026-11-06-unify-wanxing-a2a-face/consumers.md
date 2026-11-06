# platform 域卡片/管理路由消费方盘点（任务 1.1，2026-11-06）

## 证据源与结论

| 来源 | 方法 | 结论 |
|---|---|---|
| platform 网关访问日志（fd-prod，pod 121m 全量） | `logs platform-65b94c5c57 | grep /api/wanxing` | **零命中**——仅 /api/fleets/report 等内部遥测 5 条 |
| platform-demo（8h 窗口） | 同上 | 零命中 |
| 仓内代码引用（paas gateway/ 全扫 `api/wanxing`） | grep -l | 仅 gateway/wanxing/{index,a2a}.js 自身（路由定义，非调用方） |
| zhiyu lane（gateway/index.js:861 import 级耦合） | 读 agent-lane.js | **只吃 `bookings.rows()`**（packs internal 部署行，与 wanxing 卡片无关）——换 packs internal 直读即解耦，`gateway/wanxing/` 可摘 |
| registry delegation 桥 | 无 wanxing A2A 地址引用（M2M 走 registry） | 无消费 |
| wanxing-ops-mcp | tool-surface.json：callers/pause/resume 打 paas `gateway/wanxing/index.js:170-206` | **唯一真消费方**——迁址即愈（3.x） |
| desktop fleet lane | wanxing-fleet.js:306 走 console devices redeem（萬星域 console 面） | 不经 paas 卡片路由，无影响 |

## 处置决定

1. **摘挂可行**：platform 域 `/api/wanxing/v1/*` 无真实外部消费方（日志+代码双证据）。
2. zhiyu 解耦 = `bookings.rows()` 改直调 packs internal API（agent-lane 已有 packsInternalBase 参数）。
3. ops-mcp 是唯一迁移对象：工具改 slug 编址打萬星 facade（facade console.js:296 callers / :248 pause+resume 已有等价路由）。
4. 保留不变：paas packs/deploy 域、host-allowance 结算（反向契约）、desktop 席位。
