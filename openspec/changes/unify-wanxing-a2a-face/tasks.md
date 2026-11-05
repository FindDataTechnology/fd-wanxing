# unify-wanxing-a2a-face 任务清单

## 1. 前置核实（阻塞摘挂，最先做）

- [ ] 1.1 platform 域卡片/管理路由消费方盘点（网关日志聚合 + registry delegation 配置 + ops-mcp + desktop lane 确认），产出消费方清单落本 change 目录（consumers.md），每条带处置决定；验证=四来源全覆盖，清单内无「未决」条目
- [ ] 1.2 依据清单定 ops-mcp 编址方向（default slug 签名改造；备选 facade 加 packId 别名），design.md 回填结论；验证=design 无 Open Question

## 2. 幂等硬化回灌（独立可先行上产）

- [ ] 2.1 paas core.js 90c80625 硬化移植 fd `services/wanxing-facade/core.js`：request_hash 绑定 + IDEMPOTENCY_KEY_REUSE 结构化错误 + error 不重放；保留 plan 选举逻辑不动；验证=单测三态（同 key 同 body 重放/异 body 拒/error 重放）绿
- [ ] 2.2 全 lane 覆盖确认：A2A 与 chat 车道均经 core 准入各测一条；验证=两 lane 各一条幂等回归用例
- [ ] 2.3 facade 镜像出片滚产（仅硬化增量）；验证=现网 probe 同 key 异 body 400 而非重跑

## 3. 管理路由与 ops-mcp 迁址

- [ ] 3.1 ops-mcp 4 管理工具改 slug 编址指 facade（按 1.2 结论），tool-surface.json 同步；验证=本地 24 测试绿+8/8 工具对 facade 真调通（callers list/add/remove/pause/resume）
- [ ] 3.2 fd-infra-deploy `wanxing-ops-mcp.yaml` 切 `WANXING_OPS_BASE_URL=https://wanxing.finddatatech.cloud` 滚产；验证=生产 ops-mcp /health surface-report 正常、registry 自报不退化
- [ ] 3.3 facade /healthz 深探针（sub2api selfCheck/registry/packs 三依赖态，超时受界）；验证=停 sub2api 模拟（改 env 指 dead port）探针 1s 内报 degraded 不挂起

## 4. paas 摘挂（最后执行）

- [ ] 4.1 zhiyu lane 解耦：bookkeeping 快照抽独立模块，zhiyu 改数据源；验证=paas 网关测试绿（含启动路径）
- [ ] 4.2 paas 摘挂 gateway/wanxing 卡片路由 + spec `wanxing-facade` 标 moved 指本仓 + twin 纪律废止注记；验证=paas openspec validate 过、网关镜像滚产后 platform 域 /api/wanxing/v1/a2a/* 返回 404/410 且网关其余面正常
- [ ] 4.3 两域一致性验收：wanxing 域卡片与（迁移后）platform 域消费方响应等价（字段/redaction 同口径）；验证=同 agent 双域 diff 为空或差异仅域名
- [ ] 4.4 本 change spec MODIFIED/ADDED 与实现终态对齐（packId 表述按 1.2 结论修正）；`openspec validate unify-wanxing-a2a-face --strict` 过
