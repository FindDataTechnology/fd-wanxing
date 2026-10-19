## 1. fleet-observer 统计层

- [x] 1.1 `stats-store.js`：stats.db（回合明细表 turn_usage + 聚合表 rollup_day(agent|pack|model, day, turns, tokens_in, tokens_out, source, basis) + collector_tokens 表 + 月度清窗），verify：单测——写入/聚合/13 个月清窗不动 rollup_day、双口径同表不混算
- [x] 1.2 ingest 分流：turn_ended（含 tokens）异步双写统计层，统计失败仅计数不阻塞，verify：单测——统计层抛错时观测入库照常 + 缺口计数器递增
- [x] 1.3 统计 API `/api/fleet/v1/stats/overview|by-agent|by-model|daily`（时间窗参数；每数字带 source+basis；无合并字段），verify：单测——响应 schema 断言口径字段全覆盖 + 手测 curl 三端点
- [x] 1.4 local ingest 端点 `/ingest/local`（collector 令牌鉴权、fsc_ 校验、events 落统计层 source=local/basis=estimated），verify：单测——无令牌拒、有效令牌入库、坏行跳过计数

## 2. sub2api 聚合通道

- [x] 2.1 实探 sub2api 用量端点形状（admin API 聚合 vs 明细），定拉取实现（design 开放问题收口，结论记 design 修订），verify：探针脚本 + 结论落档
- [x] 2.2 小时级拉取任务（STATS_SUB2API_BASE/TOKEN env；只读 API；落库 source=sub2api/basis=billed；失败降级+stale_since），verify：单测——假 sub2api 端点（成功/401/超时三态）+ stale 标注

## 3. collector（本地采集器）

- [x] 3.1 `services/stats-collector/`：parser registry + Claude Code JSONL 解析器（usage 字段四元组）+ 位点文件增量，verify：单测——fixture JSONL 增量解析两次不重投、格式漂移行跳过计数
- [x] 3.2 批投 CLI（小时批、tailnet 直连 observer、fsc_ 令牌 env）+ launchd plist 样例，verify：本机对生产 observer 实投一批（先 1 小时窗口）入库可查
- [x] 3.3 observer CLI 铸 collector 令牌（一次性 env/命令），verify：铸/验/吊三态

## 4. console 消耗视图

- [x] 4.1 wanxing-web `StatsView`（时间窗选择器 + 三口径分块总览 + by-agent/by-model 表 + daily 序列；口径标签视觉分色 billed/estimated），verify：组件测/构建绿 + 本地起 web 连生产 observer 数据眼见
- [x] 4.2 console 导航挂「消耗」入口（机群板邻座），verify：路由可达 + 断言三口径块各自渲染

## 5. 出片与验收

- [x] 5.1 出片（纪律门：先 `fd-build-channel` 判路；observer 与 wanxing-web 两镜像），verify：relay OK + skopeo digest + 台账记录
- [x] 5.2 部署滚版（fd-infra-deploy 两清单 tag bump → ArgoCD）+ sub2api 凭据 secret，verify：rollout 绿 + stats API 出真数（fleet 口径对得上 board 回合计数）
- [x] 5.3 验收四判据（①✓ ②✓ ③✓ ④✓部署侧/浏览器眼见待用户——reports/2026-10-19-prod-acceptance.md 含复验追加）：①fleet 口径 API 真数 ②sub2api 口径聚合一致（复验发现 env 名/认证头/逐请求覆盖/分页假总量四缺陷，全修后生产实证 310 桶·238,786 请求·billed 口径出数）③collector 本机 24h 后 local 口径出数（launchd 曾误卸已重载）④console 三口径分列（门面代理 3080 实测 200），verify：验收记录入本 change `reports/`
- [x] 5.4 台账与底稿收尾（registry-maintenance 记录 + explore 底稿切片③完结标记 + 记忆更新），verify：文档链接互达
