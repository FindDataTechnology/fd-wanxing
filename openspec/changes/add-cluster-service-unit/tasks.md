# Tasks — add-cluster-service-unit

## 1. facade：内核与存储

- [ ] 1.1 store.js：`wanxing_usage` 加 `cluster_turn_id` 列（迁移与 mission_id 同式）；
  `usageInsert` 写入；`usageByClusterTurn(id)` 只读
- [ ] 1.2 core.js：`recordUsage({..., clusterTurnId})` 落列（additive，缺省 null）
- [ ] 1.3 a2a.js：成员回合核心抽成 `runMemberTurn({caller, state, text, contextId, idemKey,
  clusterTurnId, timeoutMs})` → `{status, text?, error?, row}`：转发 + 答案口径 + finish（usage /
  settle / 回调 / fleet 事件）全复用；per-agent `message/send` 路径改为调用它（行为零变化，
  既有 50 测试全绿）

## 2. facade：集群单位

- [ ] 2.1 cluster.js：`resolveUnit(clusterSlug)`——集群索引 × 部署快照 → `{id, slug, name,
  description, policy, members: [{id, name, role, served, slug?, agentPath?}]}`；在列规则
  ≥1 默认成员在役；`listUnits()` 公开成员口径
- [ ] 2.2 cluster.js：`GET /api/wanxing/v1/clusters` + `/a2a/cluster/:slug/.well-known/
  agent-card.json`（skills = 在役公开成员；streaming false；`cluster` 扩展块）；快照硬过期
  503 同目录
- [ ] 2.3 cluster.js：`POST /a2a/cluster/:slug`——key 门 / 协议形状（send-only）/ 单位存在 /
  RPM 一次 / plan 一次 / 复合幂等分流 / (caller, 单位) 槽 / 成员集解析（默认成员或
  `metadata.agents` 子集，未知 -32602）/ 逐成员准入（skipped 带原因）/ 零准入结构化拒绝
- [ ] 2.4 cluster.js：扇出——并发上限 `maxConcurrentRuns`（缺省成员数）、成员超时
  `WANXING_CLUSTER_MEMBER_TIMEOUT_MS`、成员上下文 `<ctx>--<agentId>`、每成员
  `idempotentSend(memberSlug, <key>--<agentId>)` 包 `runMemberTurn`
- [ ] 2.5 cluster.js：聚合 all / first / summary（lead = 声明序首个成功默认成员；综合失败回落
  all 注明；summary 回合 idem `<key>--summary`）；响应 message + `metadata.cluster`；全员
  error → `-32040 CLUSTER_ALL_FAILED`
- [ ] 2.6 a2a.js：A 的目录 / 卡 `cluster` 标记在单位在列时补 `slug` + `url`
- [ ] 2.7 routes.js 接线（cluster face 在 a2a face 之前注册；注入 clusterIndex / listDeployments /
  runMemberTurn / core / report）

## 3. 测试（test-wanxing-cluster.mjs，stub registry / upstream / sub2api 同 facade 测试）

- [ ] 3.1 单位解析：在列规则 / 部分小队 served 口径 / 全私有不在列 / 快照硬过期 503
- [ ] 3.2 卡：公开无凭据 / skills=在役公开成员 / streaming false / url 指向 facade
- [ ] 3.3 回合准入：stream -32601 / 未知成员 -32602 / paused 成员 skipped / 全员 paused 拒绝且
  零上游调用 / 成员槽被占 skipped / RPM 只计一次
- [ ] 3.4 扇出：maxConcurrentRuns=1 串行（时序断言）/ 缺省并行 / 成员超时 → error / 成员上下文
  派生
- [ ] 3.5 聚合：all 分节与脚注 / first / summary（lead 选择、额外回合、综合失败回落）/ 全员
  error → CLUSTER_ALL_FAILED
- [ ] 3.6 计量：成员行逐条（agent_slug / idem_key 派生 / cluster_turn_id 同值）/ 单位零行 /
  成员 error waived / 复合 replay 零新行 / 中途崩溃重放只重跑未完成成员 / 部署者分成按成员
- [ ] 3.7 per-agent 回归：既有 test-wanxing-facade 50/50（runMemberTurn 抽取零行为变化）

## 4. web 与文档

- [ ] 4.1 CatalogView：组头在 `cluster.url` 存在时渲染端点代码行 + 复制 + 「集群调用」链接；
  不存在时提示「尚不可整体调用（无默认成员在役）」
- [ ] 4.2 DocsView：「集群调用」节（路由 / send-only / `metadata.agents` 与 `aggregation` /
  逐成员计费与 summary 额外回合 / curl 样例）；A2aSample 集群变体
- [ ] 4.3 vite build 绿

## 5. 上线与实证

- [ ] 5.1 出片 facade + web 双镜像 → relay → ccr digest → GitOps → pod imageID 核验
- [ ] 5.2 生产实证（集群包默认成员已部署为前置）：`GET /clusters` 列出单位；卡公开可取；
  用调用键 `message/send` 默认扇出 → 两成员各一节；`aggregation: summary` → 综合文本 +
  三条 usage 行同 `cluster_turn_id`；replay 同 key 零新行；目录组头显示端点
- [ ] 5.3 台账 `docs/`（发布记录）+ 记忆
