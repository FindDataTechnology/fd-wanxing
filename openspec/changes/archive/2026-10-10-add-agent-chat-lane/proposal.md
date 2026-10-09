# Proposal: add-agent-chat-lane

## Why

萬星上的 agent 今天只有 API 车道（A2A + 调用键）：人类要用一个 agent 必须写程序或贴 key，主人也无法回答「谁在调用我的 agent」。给部署的 agent 一个**登录即聊的对话页**（对话车道），并把按主人切分的调用记录交到部署者手里——这是对外获客面和部署者信任面的共同缺口。

## What Changes

- **对话车道**（新增对外面）：`wanxing-web` 新增 `#/chat/:slug` 对话页（SSE 流式、聊天历史留客户端、服务端零正文）；访客经共享 Logto tenant 登录（验 ID token、**不查允许名单**——注册已开放，console 名单只护管理面）；门面新增 `/api/wanxing/v1/chat/:slug` 回合路由，复用现有准入内核（准入/槽/幂等/记账）。
- **三层扣减瀑布**（新计费语义，调用者与结算方分离——ADR-0002）：访客回合按分钟记账，结算方依次为 ①平台补贴（全局开关 + 每访客每日 10 分钟默认，先扣）②主人池（per-agent 一次性限额，实扣该部署的计费键，随时可调）③访客自带键桥接（额度耗尽后粘贴自己的 sk- key 走现有 API 车道继续聊，零新机制）。
- **对话开放范围**：仅 public agent，且满足（平台补贴开 OR 主人池 > 0）双门；chat 渠道独立更紧限流（默认 6 次/分/访客）。
- **调用记录**（补主人面）：usage 账本加 `channel`（api|chat）与 `settler` 维度；console 部署详情新增「调用记录」视图（调用者×渠道×回合×分钟聚合、访客邮箱脱敏、最近活动流）与「对话额度」配置面板（主人池）；记录按 `deployedBy` 归属主人，ops 看全量；账本长存。
- **借用契约扩展**：主人池实扣经 packs internal API 新增的内部结算端点（键值不出謙面，沿用「key 不过门面」纪律）。

### Non-goals

- 访客自动开户 provision（登录即建 sub2api 账户+铸键）——验证需求后再议。
- 私有 agent 的对话（需 Logto 身份↔sub2api 账户打通）。
- 服务端存储聊天正文（保留期/合规是独立设计，v1 服务端零正文）。
- 主人池月度重置（一次性限额语义；订阅感后续叠加）。

## Capabilities

### New Capabilities

（无——对话车道落在两个既有能力的增量里）

### Modified Capabilities

- `wanxing-facade`: 新增访客鉴权（tenant 身份、不查名单）、对话回合路由与三层瀑布准入、渠道化记账与结算方分离（含 packs 内部结算契约）、主人池 deployer 门禁配置、每访客每日补贴、chat 独立限流、主人视角调用记录 API（聚合+脱敏）。
- `wanxing-web`: 新增 `#/chat/:slug` 对话视图（登录门、余额展示、耗尽态+自带键桥、客户端历史）、catalog 卡片对话入口（仅可聊时）、console 调用记录与主人池面板。

## Impact

- **services/wanxing-facade**：a2a 内核复用出对话路由族；store 新增主人池表与渠道维度；结算 sweep 扩 settler 分支；console.js 新增记录/池面路由；logto-auth 拆出无名单验签。
- **wanxing-web**：新 ChatView + catalog CTA + console 两面板；auth 复用 PKCE 基建。
- **paas（借用契约对端）**：packs internal API 新增部署级结算端点（deployment_keys 实扣）；部署行 `deployedBy` 已在，无需改。
- **部署**：facade 新 env（补贴开关/每日分钟/平台结算键/chat RPM/日界时区）；web 无新依赖。
- **词汇/ADR**：CONTEXT.md 六词条已落（访客/对话车道/结算方/平台补贴/主人池）；ADR-0002「对话车道的调用者/结算方分离」随本 change 落 docs/adr/。
