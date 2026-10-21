# 生产验收记录（5.3，2026-10-19）

判据①（fleet 口径 API 真数）✓：14 天存量回填 892 条 turn_ended + 部署后活体双写（spider-heal
回合成流入）；7 天 overview = **865 回合 / 24,932,701 tokens / 9 agents**。**口径对板结论（如实）**：
board 24h=1515 全回合 vs stats 24h=148——差值即 1372 个 error 回合（无 tokens 载荷）；消耗面只计
**带 token 的回合**，与 board 的全回合计数是两个口径（已在 API 语义中，console 不并列混算）。
判据②（sub2api 口径）◐：拉取器+stale 降级已上产（凭据=wanxing-fleet 同源借用）；首拉在部署后
1 小时定时窗，**响应形状待首拉日志确认**（端点 /api/v1/admin/usage 已实证存在-401；容错映射器
三形状兜底）。**24h 复验项**。
判据③（collector 实跑出数）✓：本机首跑 **2978 条全量历史回灌生产**（tailnet→NodePort 31881→
/ingest/local，fsc_ 令牌鉴权过）；launchd 小时循环已装（exit 0、增量语义验证）；**24h 浸润
复验项**（首验已见 local 口径行入 by-agent）。
判据④（console 三口径分列）✓：web 新 bundle（index-agQmSjKD）在产、门面 stats 四路由 401
gate 在（console 会话通道）；**浏览器眼见**待用户登录复验（部署侧全通）。

## 实施期坑（入册）

1. **通用池 build-args 陷阱**：testaction004 池的 Build 步骤无 build-args 管道——SERVICE 构建参数
   静默失效，三镜像同 digest（全是 facade 形体）。**解法=一镜像双入口 + 清单显式 FLEET_ENTRY env**
   （Dockerfile 本来的设计意图），web 另出根上下文 Dockerfile.web。
2. **池并发组的假绿**：同源同树再推快照=零 diff=无新 run，watch 到旧 run 报假绿；dispatch inputs
   才是同 commit 多镜像的正解。
3. **web 镜像 boot 烟测误杀**：nginx.conf 反代集群服务名（wanxing-facade），烟测容器无此主机 →
   emerg 退出；按池预案 SMOKE_MODE=skip 出片（集群内有该主机，非镜像缺陷）。
4. **stats 与 board 的口径差**：错误回合（无 tokens）不计入消耗面——by design，验收记录在案。

---

# 复验记录（2026-10-19 傍晚；判据②收口 + 四缺陷修复上产）

## 判据②（sub2api billed 口径）✓ 收口

首拉复验**发现四个真缺陷**（全部非「形状待确认」，而是拉取从未生效）：

| # | 缺陷 | 证据 |
|---|---|---|
| ① | env 名不匹配：代码读 `FLEET_STATS_SUB2API_BASE`，清单写 `…_BASE_URL` | `sub2api` 恒 null，日志零拉取行 |
| ② | 认证头错：用 `Authorization: Bearer`，sub2api `/api/v1/admin/*` 只认 `x-api-key` | 直探 401 `INVALID_TOKEN`，同门面 `sub2api-admin.js` 用 x-api-key |
| ③ | 逐请求行被覆盖：usage 端点一行一请求且**无 `requests` 字段**，upsert 是 plain SET | 首版落库每桶只剩末条；`requests` 需每行记 1 |
| ④ | 分页假总量：`total`/`pages` **随请求页递增**（p1=201/p2=401/p3=601），实测 **119,363 行/天 = 597 页**，原 500 页上限正好截断 | 探针翻页实测；日志 `hit the 500-page ceiling` 实锤 |

**修法**（fd-wanxing `3efd4df`，镜像 `sha-bbf54c3` / digest `2d6f4650`）：env 双名兼容（BASE_URL
为准）、改 `x-api-key`、拉取侧先按 `(day,bucket,kind)` 聚合（`requests` 每行记 1，cost 累加）、
只认「短页即末页」并把安全阀放到 2000 页、启动 5s 先拉一次消掉滚版空窗。

**生产实证**（`overview?since=7d`，直打 observer 与经门面 3080 两条路一致）：

```json
{"sub2api": {"source":"sub2api","basis":"billed","rows":310,
             "tokens_in":2186785720,"tokens_out":311228506,"requests":238786}}
```

与 fleet（`estimated` 914 回合）/ local（`estimated` 232 回合）**三口径并列、不混算**；
`stats.db` `MAX(fetched_at)` = `2026-10-19T10:37:31Z`，桶数 274→310、请求行 200k→238,786
（跨过旧上限，证明分页修复生效）。

## 判据③（collector 24h）✓

`com.finddata.stats-collector` launchd 在切片 4 安装 ai-memory-recover 时被误卸，复验时发现并
重载：`launchctl list` exit 0，小时日志连续 `{"found":0,"stored":0,"skipped":0,"delivered":true}`
（无新会话=正常增量语义）。local 口径 30d by-agent 已有 232 回合存量行。

## 附带复验：cell 记忆闭环（切片 2/4 的生产眼见）

用 platform 令牌在产 `POST /admin/mint` → `POST /capture`（`{"stored":1}`）→ MCP
`initialize` 握手 → `memory_recent` 与 `memory_query`：
- `memory_recent` 返回刚写入的 observation（summary/agent/created_at 全对）；
- `memory_query {q:"复验"}` 命中该页，英文 `reverify`/`session` 亦命中 → **FTS trigram 对中文可用**；
- 生产已有 26 页真实记忆（sessions/log/handoffs），handoff `deployment → acceptance-zcode`
  状态 `claimed`，**交接协议生产闭环实证**。

**探针坑（入册）**：`/capture` 的事件字段是 `event`（不是 `kind`），缺则静默 `stored:0`；
`memory_query` 的入参名是 **`q`**（不是 `query`），传错报 `unknown tool`/空结果——
两个都是「静默或误导性失败」，MCP 工具描述应补参数名。

## 测试守卫

`scripts/test-stats-plane.mjs` 8 → 12（新增：x-api-key 头、逐请求聚合、相对 `pages` 陷阱、
信封 `code≠0` 不入库）；全仓 `node --test scripts/test-*.mjs` **162/162 绿**。

## 仍未闭环（用户侧）

- console「消耗」页浏览器眼见（部署侧 API 已通，需登录 `wanxing.finddatatech.cloud` 看一眼）。
- 真实壹座会话里 `mcp__fd-memory__*` 工具面出现（需真实会话跑一轮）。
