# Tasks: add-embed-copilot-lane

## 1. facade 基座：账本 tier 列与验签放宽

- [x] 1.1 store 账本扩展：`wanxing_usage` 加列 `visitor_tier`（默认 `tenant`，启动 ALTER 老行回填）；匿名日额聚合查询（channel=chat、settler=subsidy、visitor_tier=anon，按 vid × Asia/Shanghai 日窗）——单测含老库迁移与匿名/租户额度互不串扰（test-wanxing-facade 绿）
- [x] 1.2 验签 aud 放宽：ID token 校验接受 aud ∈ {萬星 client} ∪ `WANXING_EMBED_AUDIENCES`（env 逗号列；未配=现状单 aud，行为逐字节不变）——单测：允许列表内 aud 通过、列表外拒、未配 env 时新 aud 拒（回归）

## 2. facade 嵌入车道：匿名凭据与双门

- [x] 2.1 ephemeral 铸发路由 `POST /api/wanxing/v1/chat/:slug/visitor-token`：Origin 门（per-agent 允许源 ∪ 平台 fallback，`WANXING_EMBED_ORIGINS`）→ per-源限速 → HMAC 签名 `{vid,slug,iat,exp}`（`WANXING_EMBED_SECRET`，TTL env）——单测：允许源铸成、拒绝源 403、限速、跨 slug 重放拒
- [x] 2.2 匿名准入分支：`verifyVisitor` 增认 ephemeral 形状（`visitorSub="anon:"+vid`）；双门（全局 `WANXING_CHAT_ANON_ENABLED` 默认 false + per-agent 匿名开关，deployer/ops 写）；匿名日额门（独立 env 默认，耗尽/未开 → 结构错带 login-upgrade 提示）；**匿名不落 host allowance**（瀑布对 anon 档短路）——集成测试：双开+额度内过、任一门关拒、耗尽拒且池不动、过期 token 拒
- [x] 2.3 结算与落账：匿名回合 channel=chat、settler=subsidy、visitor_tier=anon；sweep 零改动验证（subsidy 分支本就存在）——单测：匿名行正确落三字段、租户行回归不变

## 3. facade 配置面

- [x] 3.1 公开 embed-config `GET /api/wanxing/v1/chat/:slug/embed-config`：回 `{chatAble, reason, anonymous, theme}`，无凭据可读，不泄额度/补贴内部态——单测：双门各态的 anonymous 布尔、私有 agent 形状、payload 无键无 token
- [x] 3.2 允许源与匿名开关管理 API（console 门，deployer-or-ops）：GET/PUT `/console/deployments/:slug/embed-settings`（origins 列表 + anonymous 布尔）——单测：deployer 写成、非本人 403、ops 兜底、下次 mint 生效

## 4. web embed 视图

- [x] 4.1 EmbedView `#/embed/:slug` 骨架：FAB+右侧 dock、无 console/站点 chrome、主题 URL 参数（accent/mode/title）、冷启动拉 embed-config——vite build 绿 + 实机走查并入 6.2
- [x] 4.2 对话复用：流式回合（同 ChatView 的 SSE 机制与耗尽/暂停/未开放显式态）、localStorage 历史（分区即每线隔离）——走查并入 6.2
- [x] 4.3 匿名起聊：首条消息前按需 mint ephemeral、匿名档可见+「登录升级」常驻、login-upgrade 错误显式态——走查并入 6.2
- [x] 4.4 popup 登录回交：`window.open` 走现有 PKCE（return 带 targetOrigin）、回调页 postMessage 回 opener、widget 落分区 storage、分区内 refresh 自续、弹窗拦截降级「新窗口打开」链接——走查并入 6.2（**不复用 console auth.js 的凭据管理**，embed 自带一套）
- [x] 4.5 宿主 token 摄入：postMessage request/response 按回合索取宿主递来的 ID token（origin 校验）、不持久化、优先于匿名档——走查并入 6.2
- [x] 4.6 上下文摄入：`wx-copilot-context` intake（origin 校验、外来源丢弃）、标记前缀拼首回合、上下文条镜像展示——走查并入 6.2

## 5. console 面与文档

- [x] 5.1 console 嵌入设置面板：允许源列表编辑 + 匿名开关（deployer/ops）——构建绿，实机走查并入 6.2
- [x] 5.2 CONTEXT.md 词条（匿名访客/嵌入车道）+ ADR「嵌入车道的身份阶梯与匿名边界」——评审通过

## 6. 部署与生产验收

- [x] 6.1 env 落位与镜像滚动（2026-10-21 完成）：Secret 补五键（embed_secret/embed_audiences=91kqy7xgs9dstnr0i2qyu/chat_anon_enabled/chat_anon_daily_minutes=3/embed_origins 空）+ yaml 五 env；镜像 sha-a711fd4 双滚（digest 318a8064/31e538d4 ccr 实证，pod imageID 对上；首次滚 sha-5b322e5 为旧快照假滚已纠正——fd-build-snapshot 从 origin clone，源仓必须先 push origin）；catalog/status/embed-config 探针全绿、匿名关态滚完
- [x] 6.2 真机四线走查（2026-10-21 ego 真浏览器，试点 agent=packs-vtdpsnmtw6oq9i99mbhbdw-pack-demo-fingpt；识律侧因走查身份非 lex-customers 组织，宿主协议线在 widget 页以同源宿主身份注入等价验证，lex 生产页片段已上 sha-7852548）：①匿名=生产协议链 mint→带上下文标记前缀→SSE 出字+UI 匿名态 ②递 token=chip 秒翻已登录+剩余 9 分钟（tenant 瀑布真数据）③上下文=条子可见+已随首回合+agent 回答真引用识律/数据集 ④popup=aloadtree 真登录→回交翻档→刷新持久——快照证据在册（embed-e2e 走查记录）
- [x] 6.3 对账与止血演练（2026-10-21）：账本 wu_d24de1cac17a818dc6f0c0d6 = chat/subsidy/anon/1min/**settled**，错误回合正确 waived（2 行 0min）；止血=关→embed-config anonymous:false + mint 403 ANON_NOT_OPEN(loginUpgrade)→开回恢复 true，分钟级杠杆实证——终态：匿名全局开+per-agent 开（fingpt/data-scout/wx-alpha 三条试点）
