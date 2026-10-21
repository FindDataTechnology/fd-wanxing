# Tasks: add-embed-copilot-lane

## 1. facade 基座：账本 tier 列与验签放宽

- [ ] 1.1 store 账本扩展：`wanxing_usage` 加列 `visitor_tier`（默认 `tenant`，启动 ALTER 老行回填）；匿名日额聚合查询（channel=chat、settler=subsidy、visitor_tier=anon，按 vid × Asia/Shanghai 日窗）——单测含老库迁移与匿名/租户额度互不串扰（test-wanxing-facade 绿）
- [ ] 1.2 验签 aud 放宽：ID token 校验接受 aud ∈ {萬星 client} ∪ `WANXING_EMBED_AUDIENCES`（env 逗号列；未配=现状单 aud，行为逐字节不变）——单测：允许列表内 aud 通过、列表外拒、未配 env 时新 aud 拒（回归）

## 2. facade 嵌入车道：匿名凭据与双门

- [ ] 2.1 ephemeral 铸发路由 `POST /api/wanxing/v1/chat/:slug/visitor-token`：Origin 门（per-agent 允许源 ∪ 平台 fallback，`WANXING_EMBED_ORIGINS`）→ per-源限速 → HMAC 签名 `{vid,slug,iat,exp}`（`WANXING_EMBED_SECRET`，TTL env）——单测：允许源铸成、拒绝源 403、限速、跨 slug 重放拒
- [ ] 2.2 匿名准入分支：`verifyVisitor` 增认 ephemeral 形状（`visitorSub="anon:"+vid`）；双门（全局 `WANXING_CHAT_ANON_ENABLED` 默认 false + per-agent 匿名开关，deployer/ops 写）；匿名日额门（独立 env 默认，耗尽/未开 → 结构错带 login-upgrade 提示）；**匿名不落 host allowance**（瀑布对 anon 档短路）——集成测试：双开+额度内过、任一门关拒、耗尽拒且池不动、过期 token 拒
- [ ] 2.3 结算与落账：匿名回合 channel=chat、settler=subsidy、visitor_tier=anon；sweep 零改动验证（subsidy 分支本就存在）——单测：匿名行正确落三字段、租户行回归不变

## 3. facade 配置面

- [ ] 3.1 公开 embed-config `GET /api/wanxing/v1/chat/:slug/embed-config`：回 `{chatAble, reason, anonymous, theme}`，无凭据可读，不泄额度/补贴内部态——单测：双门各态的 anonymous 布尔、私有 agent 形状、payload 无键无 token
- [ ] 3.2 允许源与匿名开关管理 API（console 门，deployer-or-ops）：GET/PUT `/console/deployments/:slug/embed-settings`（origins 列表 + anonymous 布尔）——单测：deployer 写成、非本人 403、ops 兜底、下次 mint 生效

## 4. web embed 视图

- [ ] 4.1 EmbedView `#/embed/:slug` 骨架：FAB+右侧 dock、无 console/站点 chrome、主题 URL 参数（accent/mode/title）、冷启动拉 embed-config——vite build 绿 + 实机走查并入 6.2
- [ ] 4.2 对话复用：流式回合（同 ChatView 的 SSE 机制与耗尽/暂停/未开放显式态）、localStorage 历史（分区即每线隔离）——走查并入 6.2
- [ ] 4.3 匿名起聊：首条消息前按需 mint ephemeral、匿名档可见+「登录升级」常驻、login-upgrade 错误显式态——走查并入 6.2
- [ ] 4.4 popup 登录回交：`window.open` 走现有 PKCE（return 带 targetOrigin）、回调页 postMessage 回 opener、widget 落分区 storage、分区内 refresh 自续、弹窗拦截降级「新窗口打开」链接——走查并入 6.2（**不复用 console auth.js 的凭据管理**，embed 自带一套）
- [ ] 4.5 宿主 token 摄入：postMessage request/response 按回合索取宿主递来的 ID token（origin 校验）、不持久化、优先于匿名档——走查并入 6.2
- [ ] 4.6 上下文摄入：`wx-copilot-context` intake（origin 校验、外来源丢弃）、标记前缀拼首回合、上下文条镜像展示——走查并入 6.2

## 5. console 面与文档

- [ ] 5.1 console 嵌入设置面板：允许源列表编辑 + 匿名开关（deployer/ops）——构建绿，实机走查并入 6.2
- [ ] 5.2 CONTEXT.md 词条（匿名访客/嵌入车道）+ ADR「嵌入车道的身份阶梯与匿名边界」——评审通过

## 6. 部署与生产验收

- [ ] 6.1 env 落位与镜像滚动：facade（`WANXING_EMBED_SECRET`/`WANXING_EMBED_ORIGINS`/`WANXING_EMBED_AUDIENCES`/`WANXING_CHAT_ANON_ENABLED` 默认 false/匿名日额 env）+ web；按迁移序 facade→web，匿名保持关滚完，/healthz + 既有探针回归全绿
- [ ] 6.2 识律试点真机四线走查：①匿名起聊（deployer 开匿名→无登录首回合出字→耗尽显式升级态）②宿主递 token（识律页片段递 ID token→秒升登录档）③上下文（pusher 推页面上下文→上下文条可见→回合带前缀）④popup 登录（BFF 形态模拟→弹窗回交→续聊）——探针/截图留档
- [ ] 6.3 对账与止血演练：匿名回合在账本三字段（chat/subsidy/anon）成行、平台键实扣一次；`WANXING_CHAT_ANON_ENABLED=false` 一键关匿名复验（mint 拒、在途回合自然收尾）——留档
