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
