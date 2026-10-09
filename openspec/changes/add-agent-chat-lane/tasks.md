# Tasks: add-agent-chat-lane

## 1. paas 借用契约端（先上、向后兼容）

- [x] 1.1 packs internal 部署级结算端点：`POST /api/packs/internal/deployments/:agentPath/host-settle`（body `{minutes, usage_id}`，内部令牌门禁，按 `usage_id` 幂等；取该部署 `deployment_keys.key_value` 经 sub2api 扣款；无键/无部署/扣款失败各回结构错）——单测覆盖幂等重扣一次、三种错误路径（实际路由形如 `:packId/:agentId/host-settle`，循 config 内部孪生约定；test-platform-billing.mjs 10/10 绿）
- [ ] 1.2 部署级结算端点集成验证：对 staging 真 sub2api 跑一次真扣款+重放（同 `usage_id` 第二次不扣）——curl 探针脚本留 `scripts/`

## 2. facade 基座：账本扩展与验签拆分

- [x] 2.1 store 账本扩展：`wanxing_usage` 加列 `channel`（默认 api）/`settler`/`visitor_sub`（启动 ALTER，老行回填 api）；新表 `wanxing_host_allowance`；聚合查询（每访客每日补贴用量[Asia/Shanghai 日界]、每 agent host 已用、byCaller×channel 聚合、最近活动流）——单测含老库迁移与日界切割（test-wanxing-facade 62/62 绿）
- [x] 2.2 logto-auth 验签参数化：`verifyIdToken(token, { allowlist })` 可选名单（console 门传名单不变，chat 门传 null 只验签名/issuer/audience/expiry）——单测：名单外身份在无名单模式通过、有名单模式拒绝（test-wanxing-logto 追加通过）

## 3. facade 对话车道

- [x] 3.1 chat 回合路由 `POST /api/wanxing/v1/chat/:slug`（message/send|stream）：访客验签 → chatability 门（public 且[补贴开 OR 池余>0]；私有 404、未开放 CHAT_NOT_OPEN、paused 423）→ chat 独立 RPM（默认 6/分/访客）+ (caller,agent) 单槽 → 瀑布判定 settler（补贴余>0→subsidy；池余>0→host；否则 402 CHAT_ALLOWANCE_EXHAUSTED 带自带键提示）→ 复用内核转发 → 落账（channel/settler/visitor_sub）——集成测试：假 runner+假 token 走通五态（subsidy/host/耗尽/未开放/限流）
- [x] 3.2 结算分支：sweep 扩 settler——host 行调 1.1 端点（幂等+退避重试）、subsidy 行扣平台键（`WANXING_SUBSIDY_KEY`，走既有 sub2api 扣款通道）、api 行零变化——单测：host 重试后 settled、失败保持 pending、api 车道回归不变
- [x] 3.3 chat status `GET /api/wanxing/v1/chat/:slug/status`：访客凭据回 `{chatAble, reason, subsidyRemainingToday, hostPoolRemaining, agent:{name,description}}`；匿名仅 chatAble+reason——单测两种凭据形态
- [x] 3.4 目录/chatable 标记：catalog 与卡片摘要带 `chatable` 布尔（快照 TTL 语义内新鲜；只出布尔不泄额度/补贴态）——单测：补贴开关翻转后 ≤TTL 反映、私有 agent 不带标记

## 4. facade console 面

- [x] 4.1 调用记录 API `GET /api/wanxing/v1/console/deployments/:slug/usage`：deployer-or-ops 门（按部署行 `deployedBy` 匹配）；回 byCaller×channel 聚合+最近 50 条活动；访客身份脱敏（`z***@domain`），ops 令牌可 `?unmasked=1`——单测：本人可读/他人拒/脱敏与解禁
- [x] 4.2 主人池配置 API（GET/PUT `/console/deployments/:slug/host-allowance`）：deployer-or-ops 写门禁；`limit_minutes` 一次性限额、随时可调、次回合生效——单测：deployer 写成、非本人 403、ops 兜底可写

## 5. web 对话视图与主人面

- [x] 5.1 ChatView `#/chat/:slug`：登录门（复用 auth.js）→ status 渲染余额（分钟+约 N 回合）→ 输入+SSE 流式渲染 → 历史存 localStorage（per slug 容量截断 200 条）→ 耗尽态渲染 402 结构错+自带键输入（key 存本地，后续直接打既有 `/a2a/:slug`）→ 未开放/暂停/404 显式态——vite build 绿；仓内无组件测试基建（web 面惯例=实机走查+截图），五态实机走查并入 6.2
- [x] 5.2 catalog 卡片 chatable 时渲染「对话」CTA（仅带标记的卡片）——构建绿；实机两形态走查并入 6.2
- [x] 5.3 console 两面板：调用记录（api/chat 分列、脱敏、活动流、后端不可达显式错误态）+ 对话额度（deployer/ops 可改限额、余额展示、一次性限额说明）——构建绿；实机走查并入 6.2

## 6. 部署与生产验收

- [ ] 6.1 env 落位与镜像滚动：facade 五 env（`WANXING_CHAT_SUBSIDY_ENABLED` 默认 false/`WANXING_CHAT_SUBSIDY_DAILY_MINUTES`=10/`WANXING_CHAT_RPM`=6/`WANXING_SUBSIDY_KEY`/日界）；按迁移序滚 paas→facade→web，补贴保持关——部署后 /healthz+回归探针（catalog/a2a/console 全绿）
- [ ] 6.2 生产全链验收（补贴关态）：deployer 配主人池 → 新注册访客登录 → chat 真回合（SSE 出字、host 结算落账）→ console 记录可见（脱敏）→ 耗尽态+自带键桥续聊 —— 探针脚本留档
- [ ] 6.3 开补贴终验：显式开 `WANXING_CHAT_SUBSIDY_ENABLED` → 新访客首回合走 subsidy 结算 → 当日 10 分钟耗尽后瀑布落 host —— 账本三态（api/subsidy/host）各至少一行实证
