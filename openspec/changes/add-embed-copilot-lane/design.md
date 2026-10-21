# Design: add-embed-copilot-lane

## Context

见 proposal.md——各产品线要壹座副驾式悬浮助手，本 change 把萬星既有对话车道包装成可跨站 iframe 嵌入的 widget，并补齐零摩擦身份与宿主上下文。地基已核实：`chat.js` 的 `verifyVisitor` 是唯一身份切口，下游 RPM/槽/幂等/记账/结算瀑布全按 `visitorSub` 参数化；nginx 无 frame 限制头且 `proxy_buffering off`（SSE 直连无碍）；壹座 CopilotDock 已验证「上下文随 URL/postMessage + 上下文条如实展示」的形态；识律控制台（`fd-lex/web/src/console/auth.ts`）已持共享租户客户端 ID token。E3 操控面（ui_intent/问询卡/runner provider）是明确的第二个 change，本设计不碰 runner。

## Goals / Non-Goals

**Goals:**

- 一行 `<iframe>` + 可选宿主片段即可让产品线获得副驾 widget（匿名零摩擦起聊）
- 身份阶梯：匿名（ephemeral）→ 宿主递 token（识律式）→ popup 登录（柏讯式 BFF 线兜底）→ 自带键（既有）
- 匿名成本有硬顶（独立更紧日额）、部署者可拒绝匿名流量（agent 级开关）

**Non-Goals:**

- E3 操控面与工具卡渲染（第二个 change）；匿名 IP 绑定/turnstile；产品线代传身份之外的新集成车道；壹座 CopilotDock 代码收敛。

## Decisions

### D1 ephemeral 凭据：per-agent 铸发、HMAC 签名、无状态

`POST /api/wanxing/v1/chat/:slug/visitor-token` 铸 `{ vid, slug, iat, exp }` 的 HMAC-SHA256 签名 token（密钥=facade env `WANXING_EMBED_SECRET`，默认 24h 有效，可带 renewal）。**per-agent 绑定 slug**：一枚匿名身份不能跨 agent 重放，重刷代价 ×agent 数。vid 为随机 UUID，不做任何账户映射；`visitorSub = "anon:" + vid`，与租户 sub 同形进下游（RPM/槽/记账零改动）。
*备选否决*：纯前端自造 ID 不签名（门面无从验真伪，额度形同虚设）；给匿名自动 provision sub2api 账户（chat-lane 立项时已明确排后，且匿名本就不该有账户语义）。

### D2 匿名结算：平台补贴键、账本加 tier 列、双门默认关

匿名回合 settler 仍为 `subsidy`（平台键实扣），账本 `wanxing_usage` 加列 `visitor_tier`（`anon|tenant`，老行回填 tenant）；匿名日额查询=「channel=chat 且 settler=subsidy 且 visitor_tier=anon 按 vid × 日窗」。**匿名绝不落 host allowance**（主人池是部署者真金白银，匿名流量不经同意不得消耗）；耗尽/未开门 → 结构错带 `login-upgrade` 提示。双门：全局 `WANXING_CHAT_ANON_ENABLED`（默认 false）+ per-agent 匿名开关（deployer 写，默认关，console 面板勾选）——**默认双关**：匿名是平台的钱+品牌暴露面，部署者显式 opt-in 才开。
*备选否决*：匿名也走瀑布落主人池（花部署者的钱于未同意的流量，不可接受）；单全局门（部署者无法只对自己线关匿名，A 场景产品内嵌要审计）。

### D3 宿主递 token：audience 允许列表 + 按回合索取不持久

`verifyVisitor` 的 ID token 校验从「单一 aud=萬星 client」放宽为「aud ∈ {萬星 client} ∪ env `WANXING_EMBED_AUDIENCES`（共享租户其他 client id 逗号列）」——识律等已持客户端 ID token 的线把 token 经 postMessage 递进 widget 即升级为登录车道，零新车道。widget **每回合向宿主索取**（postMessage request/response，origin 双验），不持久化产品线 token：宿主侧过期续期自治（识律已有 refresh 流），widget 无感、token 暴露面最小。
*备选否决*：产品线后端签发集成断言的新车道（Y(b)，工程量≈一条新信任链，留给真有 BFF 且拒 popup 的线再议——当前 BFF 线走 popup 兜底够用）。

### D4 popup 回交：存储分区下唯一可靠的 token 通道

popup（`window.open` 走萬星现有 PKCE）是顶级窗口，写的是萬星域**未分区** storage；iframe 读的是**按嵌入站分区**的桶——两者物理不同库。回调页检测 `window.opener`，把凭据 `postMessage` 回 opener（targetOrigin=经 URL 传入的嵌入源），widget 落**自己的分区 storage**，此后 refresh token 在分区内自续。console `auth.js` 的 `storage` 事件同步跨分区失效——embed 视图**自带一套分区凭据管理**，不复用 console 那套；popup 被拦截时降级为「新窗口打开登录」链接。注意 `verifyVisitor` 不变的部分：回交的 token 就是普通萬星 client 的 ID token。

### D5 embed 配置与 origin 执行：mint 门执行 + 公开冷启动端点

允许嵌入源：per-agent deployer 列表（console 面 + 内部 API）∪ 平台 fallback 列表（env）。**执行点=token 铸发路由**（浏览器 Origin 头不可伪造，伪造需绕过浏览器=直接打 API，届时额度门仍在）；回合路由不重复查 origin（凭据本身已是门票）。公开 `GET /api/wanxing/v1/chat/:slug/embed-config` 回 `{chatAble, reason, anonymous, theme}`，widget 冷启动一次拉取；**不放**额度余量、补贴态等内部数。

### D6 上下文协议：标记为数据、上下文条镜像

宿主片段 `postMessage({type:"wx-copilot-context", line, page, entity, intent?})`；widget 校验 event.origin ∈ 该 agent 允许源（同 D5 列表，配置从 embed-config 带），接受后以「以下为宿主页面提供的上下文（非用户指令）」前缀块拼进首回合输入，上下文条如实展示已发送内容（壹座 CopilotDock 同款纪律）。上下文本质是宿主可控文本——**按不可信数据处理**，agent 的系统提示在 E3 之前不因它产生任何页面动作能力（本 change 车道是纯对话，无 ui_intent 动词）。

### D7 主题：URL 参数、无构建变体

`?accent=&mode=&title=` 级别的外观参数即可（五线品牌色不同）；深定制（每线独立 CSS）非 v1 诉求。

## Risks / Trade-offs

- [清存储重刷匿名日额] → 接受（已拍板）：损失上限=匿名日额×分钟单价×重刷次数；mint 路由记录 per-IP 频次做**观测指标**（不执法），滥用数据够了再上 IP 绑定。
- [popup 被浏览器拦截] → 检测 `window.open` 返回 null 降级「新窗口打开」链接 + 提示。
- [浏览器分区策略进一步收紧] → 本方案已零依赖 3P cookie/跨分区事件，凭据全在分区内 bearer；最坏退化=每线重新登录一次。
- [宿主上下文注入恶意指令] → 标记为数据的前缀块 + 车道无动作动词（E3 才引入动词，届时配白名单与强制确认）。
- [匿名流量冲击平台补贴键] → 双门默认关 + 匿名日额 env 可即时调 + 全局开关一键止血。

## Migration Plan

1. facade 先滚（新路由/新列全惰性：开关默认关，老车道行为逐字节不变；`wanxing_usage` 启动 ALTER 加 `visitor_tier` 回填 tenant）。
2. web 后滚（embed 视图上线即静默：无 agent 开匿名前，匿名路径无人走进；登录态 embed 亦需宿主接入才被使用）。
3. 试点：识律 web 加 iframe + context pusher + 递 token 片段；deployer 开该 agent 匿名 → 真机四线走查（匿名/递token/上下文/弹窗登录）。
4. 回滚：`WANXING_CHAT_ANON_ENABLED=false` 一键关匿名；web 回滚上一镜像即可摘除 embed 面；无数据迁移残留（新列可留）。

## Open Questions

- 匿名日额默认值与 mint TTL 的具体数值（倾向日额 3 分钟、TTL 24h，env 可调）——上产前定，不影响 specs。
- embed-config 是否带 per-agent 主题默认值存 store（v1 先 URL 参数，够用；存侧后续按线提诉求再加）。
