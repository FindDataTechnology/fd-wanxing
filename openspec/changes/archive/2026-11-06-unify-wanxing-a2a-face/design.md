# unify-wanxing-a2a-face 设计

## 部署顺序（硬约束）

```
[1] facade 滚新镜像（硬化+管理路由+healthz 深探针）
      v  此刻 paas 旧路由仍在：ops-mcp 照旧，零影响
[2] 消费方迁移
      - wanxing-ops-mcp: WANXING_OPS_BASE_URL → https://wanxing.finddatatech.cloud
      - platform 域存量调用方：按前置核实清单逐条切
[3] paas 网关滚镜像（zhiyu 解耦已入 + 摘挂 wanxing 卡片路由）
      v  摘早必断 ops-mcp 管理半边——[2] 未完不动 [3]
[4] paas spec 标 moved + twin 纪律废止（同一次 paas 收口提交）
```

## 编址决策：ops-mcp 改 slug，facade 不加第二套编址

ops-mcp 4 个管理工具现签名是 (packId, agentId)→paas 路由；facade 已有 (slug) 编址的 console 等价路由（console.js:296 callers、console.js:248 pause/resume）。两个方向里选 **ops-mcp 工具签名改 slug**：

- facade 不必新增 packId 路由与映射层（少一面）；
- 无真实客户，工具签名 breaking 零成本；
- spec 相应写为「pack 编址」的表述需回调——以本 design 为准：**统一 slug 编址，spec 中 packId/agentId 表述在 specs 阶段修正为 slug**（新需求文本已按「pack addressing」起草，落 spec 时改为 slug addressing + 台账侧提供 packId→slug 发现）。

保留一句兜底：若核实发现 tool-surface.json 已对外承诺 packId 签名且改签名代价高，则反向（facade 加 packId 别名路由）——由前置核实任务的结论定，default 改 slug。

## 前置核实清单（任务 1 的产出物）

platform 域 `/api/wanxing/v1/a2a/*` 与 `/api/packs/:id/deployments/:agentId/callers|pause|resume` 的消费方盘点：

1. platform 网关访问日志（grep 路径，分调用方聚合）；
2. registry delegation 桥配置（M2M 是否指 platform 域 A2A 地址）；
3. wanxing-ops-mcp（已知，切址即愈）；
4. desktop fleet lane（wanxing-fleet.js:306 走 console devices redeem，不受摘挂影响——确认即可）。

每条消费方记录：调用方/频次/处置（切萬星域/退役/保留理由）。清单为空摘挂才动。

## zhiyu 解耦

`gateway/index.js:861` 直接 import `wanxing.bookkeeping` 喂 zhiyu lane。拆法：bookkeeping 快照缓存抽成 `gateway/lib/bookkeeping-snapshot.js`（或独立模块），zhiyu 改吃独立模块；gateway/wanxing/ 摘挂不再影响启动。paas 侧测试锁启动路径。

## 幂等硬化移植

来源=paas core.js 90c80625（D1/D2）：request_hash 绑定（sha256 规范化 body）、key-reuse 结构化错误（IDEMPOTENCY_KEY_REUSE）、error 结果记录不重放。fd 侧 chat/A2A 两 lane 均过 core 准入，硬化落 core.js 一处即全盖。移植时保留 fd 侧 10-22 后新增的 plan 选举逻辑（core.js:199-234）不动。

## Non-goal 重申

platform 域域名不 301（存量迁移完再议）；agent-runner 不动；packs 内部 API 反向契约不动。
