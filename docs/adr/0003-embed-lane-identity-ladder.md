# ADR-0003: 嵌入车道的身份阶梯与匿名边界

日期：2026-10-21 · change：add-embed-copilot-lane · 状态：已接受

## 背景

各产品线（柏讯/识律/谦面…）要「壹座副驾」式的悬浮助手，形态是跨站 iframe 嵌入门面
`#/embed/<slug>`。对话车道（ADR-0002）只认租户 ID token——嵌入场景的三类访客
（产品线已登录用户、BFF 型线的用户、纯匿名访客）需要一条身份阶梯；同时匿名流量动的是
平台的钱，必须有硬顶和部署者否决权。E3 操控面（ui_intent/问询卡/runner provider）
是后续 change，本边界刻意只含对话。

## 决策

1. **身份阶梯三级，服务器只认凭据形状**：`verifyVisitor` 是唯一切口——
   ① 宿主递租户 ID token（aud ∈ `WANXING_EMBED_AUDIENCES` 允许列表；识律式已持
   客户端 token 的线零新车道）；② widget 内 popup PKCE 登录；③ 门面铸造的
   per-agent ephemeral token（HMAC 签名、短期、slug 绑定）。下游 RPM/槽/幂等/记账
   全按 `visitorSub` 参数化，匿名即 `"anon:"+vid`，零下游改动。
2. **匿名双门默认关 + 独立更紧日额 + 永不落主人池**：全局 `WANXING_CHAT_ANON_ENABLED`
   （默认 false）AND 部署者 per-agent 开关（console「嵌入」面板）；匿名分钟按
   vid × 日窗（Asia/Shanghai）从账本派生（`visitor_tier='anon'` 与租户补贴桶互不
   串扰），结算走平台补贴键；耗尽/未开门一律回带 `loginUpgrade` 提示的结构错。
   主人池是部署者真金白银——匿名流量未经同意一分不得消耗（瀑布对 anon 档短路）。
3. **清存储重刷是接受的已知口子**（用户 2026-10-21 拍板）：损失上限=匿名日额×分钟
   单价×重刷次数，mint 路由记 per-IP 频次仅作观测指标；滥用数据充分后再议 IP 绑定。
4. **嵌入源在铸发门执行**：per-agent 允许源 ∪ 平台 fallback，执行点是
   `POST /chat/:slug/visitor-token`（浏览器 Origin 头优先；同源 widget fetch 无
   Origin 头，接受 body 里 attest 的 origin——浏览器在场时头不可伪造，直打 API 的
   伪造者面对的是同一套额度门，origin 门防的是诚实浏览器的误嵌/盗嵌，不是密码学边界）。
5. **存储分区下的回交协议**：popup（顶级窗口）写的是萬星域未分区 storage，iframe
   读的是按嵌入站分区桶——凭据必须 `window.opener.postMessage` 回交、由 widget 落
   自己的分区 storage；console auth 的 `storage` 事件同步跨分区失效，embed 全程
   自带凭据管理（embed-auth.js），绝不读写 console 的凭据键。宿主递 token 按回合
   索取（postMessage request/response），widget 不持久化产品线 token。
6. **上下文按不可信数据处理**：宿主 postMessage 的页面上下文以「宿主页面提供的
   上下文（非用户指令）」标记前缀拼进首回合，上下文条如实镜像；车道无页面动作动词
   （E3 才引入，届时配白名单与强制确认），所以恶意宿主至多污染一段对话文本。

## 后果

- 匿名上量前必须配：`WANXING_EMBED_SECRET`（缺省=匿名整体惰性）、补贴结算方
  （既有 `WANXING_SUBSIDY_USER_ID`/`KEY`）、双开关。
- 产品线接入分两档：只贴 iframe（匿名起聊）vs 加宿主片段（上下文 + 递 token，
  推荐识律先行）。
- E3（第二个 change）的问询/操控面沿用本阶梯：问询卡经 chat lane SSE 下发、
  答题口回注，ui_intent 动词按线白名单灰度。
