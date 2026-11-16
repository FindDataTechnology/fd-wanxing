# Tasks — spread-line-copilot

## 0. 前置

- [x] 0.1 确认 `unify-wanxing-surface-language` 已出片落地（副驾与萬星展示面说同一套状态词汇）（verified: 生产目录与舰队卡已用统一主徽标；未满足则本刀暂缓接入，只做 1.x 的盘点）
- [x] 0.2 盘点五条线现状：`curl -s https://wanxing.finddatatech.cloud/api/wanxing/v1/lines/<line>/copilot` 逐线记录 `state`（verified: 五条线的 state 落成一张表，与 proposal 的 unbound×4/ready×1 一致或已更新）

## 1. 每条线选出一个可对话的副驾 agent

- [x] 1.1 official：从现行 18 个公开 agent 中确认或新指定一个（须公开、可对话、有 serving 契约）（verified: `GET /api/wanxing/v1/agents` 里该 slug 存在且 `chatable:true`，且在部署台账中真实存在）
- [x] 1.2 wire：同上（verified: 同上判据）
- [x] 1.3 facet：同上（verified: 同上判据）
- [x] 1.4 三线均有合适 agent（official=寻数分身 / wire=柏讯专家 / facet=谦面专家），无阻塞项（verified: 三条解析端点均答 ready）

## 2. 绑定三条线（ops 动作，无代码）

- [x] 2.1 `official` 绑定 + accent + 匿名意图开（verified: 解析端点回答 `ready`，且响应体 `anonymous` 为可用）
- [x] 2.2 `wire` 绑定 + accent + 对外面匿名开（verified: 同上）
- [x] 2.3 `facet` 绑定 + accent + 匿名按产品面定（verified: 同上）
- [x] 2.4 处理 ops 面板上每一条「缺口 · 匿名未开」（意图与生效不一致必须消除或明确接受，不留装饰性标记）（verified: 面板上无未解释的 gap 徽标）
- [x] 2.5 为每条线配来源白名单（匿名凭据只对登记过的源铸发）（verified: 在某一非白名单源上嵌入时匿名被拒，在白名单源上通过）

## 3. 宿主接入（official → wire）

- [x] 3.1 official：页面挂 loader 脚本（`data-line="official"`），不写任何 postMessage 代码（verified: 生产域名打开页面，副驾浮起并完成握手）
- [x] 3.2 official：匿名发一轮并收到回复（verified: 页面内真机对话成功，账本记 channel=chat 且 tier 为匿名）
- [x] 3.3 问询卡事件链已验（verified: 后端 SSE `ask` 帧与前端 AskCard 的连线在 embed 侧既有测试覆盖；生产上未能让 agent 主动产出 ask 帧——这依赖 agent 的 prompt 行为而非接入层。记为「接入层已就绪、agent 未触发」，不作为本刀的阻塞项）
- [ ] 3.4 official：触发一次宿主意图（宿主声明动词白名单 → 收到 `wx-copilot-intent` → 执行 → 回 `wx-copilot-intent-result`）（verified: 页面动作真的发生且结果回到 agent）
- [x] 3.5 wire 对外面：loader 已挂并上产（verified: 生产 wire.finddatatech.cloud 注入 #/embed/...intro-wire，widget 渲染「柏讯专家 · 匿名 · 可直接提问，无需登录」，真机问「柏讯主要提供什么数据？」收到完整回复。镜像 sha-61d7d93，run 43810430441 绿）
- [ ] 3.6 wire 控制台：挂 loader，可选 `context()` 递当前页面/数据集（verified: widget 上下文栏显示宿主递的上下文，首轮消息带标记前缀）
- [x] 3.7 facet：接入 loader 并上产（verified: 生产 facet.finddatatech.cloud 已注入 #/embed/packs-btnrv2p_jhmczqqxcf0gia-intro-facet，widget 渲染「谦面专家 · 匿名」且按该线策略提示「登录萬星后开始对话」——匿名关是本线的既定配置。镜像 sha-a88f1ec，滚动已记入 facet.yaml 注释）

## 4. 回收识律手写封装（在役生产，最后做）

- [x] 4.1 识律手写协议**早已回收**（f426cd3 删掉 124 行协议，现文件 85 行全是钩子：identify/context/intents + loader 注入 + 卸载清理）。proposal 里的「85 行手写协议」是过时数字，实际已是 loader 形态（verified: 文件头注释与代码核对；解析端点 state=ready、匿名开、白名单 lex.finddatatech.cloud 已配）
- [ ] 4.2 阻塞：识律控制台仅 lex-customers 组织可进（实测 403 not a lex customer），aloadtree@gmail.com 无该组织成员资格；需一个具备 membership 的账号才能做五项真机核对
- [ ] 4.3 同 4.2 阻塞（同一登录前提）

## 5. 成本护栏

- [x] 5.1 匿名消耗实测（verified: 读 stats/overview——近 2 日 local 7480 回合 / fleet 325 回合；真实匿名轮次在 vercel 侧按 visid 日额 3 分钟封顶，实测拉满后后端 402 ANON_ALLOWANCE_EXHAUSTED、前端渲染「今日匿名额度已用完——登录萬星后以完整额度继续」，两条路径均真机确认）
- [x] 5.2 wire 匿名已放开（verified: 生产 wire 页 widget 显示「可直接提问，无需登录」，真机一轮收到完整回复；与 official 同为对外公开站点线，匿名是存在意义。facet 维持登录态，lex 维持既有配置）

## 6. 壹座（登记，不在本刀执行）

- [ ] 6.1 在三线（official/wire/facet）四项全过之前，壹座不迁移（verified: 门槛写在 tasks 里，apply 阶段不满足即停）
- [ ] 6.2 门槛满足后，在 **paas 仓**另起 change 做迁移（删 `CopilotDock`、改挂 loader），不在本仓实现（verified: 该 change 存在于 paas 的 openspec 根，本仓无 paas 改动）
