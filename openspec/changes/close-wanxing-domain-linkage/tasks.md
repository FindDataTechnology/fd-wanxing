## 1. 契约工件（机器可读的那一份）

- [x] 1.1 新增 `contracts/wanxing-public-api.v1.json`：JSON Schema 覆盖三个被消费读面的响应形状（`/api/wanxing/v1/agents`、`/api/wanxing/v1/ops/usage`、`/api/fleet/v1/board`），顶层 `x-contract-rev: "1"`，每个被消费字段带一行 `description` 指明哪个消费者在用（值取自 design 的入向消费者表）。验证：`python3 -c "import json;json.load(open('contracts/wanxing-public-api.v1.json'))"` 通过，且 schema 里能 grep 到三个消费侧字段名（`byCaller`、`ingest_lag`、`chatable`）
- [x] 1.2 新增根层 `scripts/check_wanxing_contract_drift.py`：比对 `fd-wanxing/contracts/` 与 `paas/facet/contract/` 两份副本的 `x-contract-rev` 与规范化形状，不一致非零退出并列差异。验证（必须证明能红）：手工把 paas 侧副本的 rev 改成 `"0"` → 脚本 EXIT=1 且打印 `rev mismatch`；改回 → EXIT=0
- [x] 1.3 `README.md` 借用契约段补一段：契约清单的入口（哪个文件、当前 rev、谁在消费）。验证：README 里 grep `x-contract-rev` 有命中

## 2. 目录行的实例状态（facade）

- [x] 2.1 抽出纯函数 `statusFor({ paused, turns7d, hardStale })` → `serving|idle|paused|unknown`（按 design D2 真值表），放在 facade 模块内并导出。验证：新增单测四组入参各自命中，且 `paused=true, hardStale=true` 命中 `paused`（暂停优先于陈旧）
- [x] 2.2 `a2a.js` 的目录 entry 组装加 `status` 与 `status_as_of`（后者取本次派生所用快照时刻，不是 `Date.now()`）。验证：`scripts/test-wanxing-facade.mjs` 新增断言——构造 turns>0 得 `serving`、turns=0 得 `idle`、部署行 paused 得 `paused`、`hardStale=true` 得 `unknown` 且 `status_as_of` 等于旧快照时间戳
- [x] 2.3 守护「附加不改形状」：无参请求的响应在移除 `status`/`status_as_of` 后与改动前逐字段深等。**改动前基线（2026-11-13 线上实测，可直接当夹具）**：条目字段并集 = `capabilities, category, chatable, cluster, description, facade, facade_stance, featured, name, skills, slug, tags, turns7d, version`（14 个，18 个条目）；顶层只有 `agents` 一个键。验证：落一份 `__fixtures__/catalog-before.json` 后做 deep-equal；字段并集若多出或少了任何一项（除新增两项）即失败
- [x] 2.4 本地实探（`WANXING_PORT` 缺省 3080；启动需 `SUB2API_BASE_URL` 与 `PACKS_INTERNAL_BASE_URL` 两个必需 env，缺任一直接拒启）：`curl -s localhost:3080/api/wanxing/v1/agents | python3 -m json.tool | grep -A1 status` 每条目有 `status`；把部署源指向一个 no-op 让其 hard-stale，重探得到 `unknown`。线上对照基线：改动前 18 个条目 0 个有 status
- [x] 2.5 **修 chatability 写死 `paused: false`**（`a2a.js:534`）：目录循环用已取到的 `entry.metadata.paused` 喂给 chatability（零新增读取；不要为此改调 `agentState`，那是 15s TTL 的暂停态复核，枚举面不需要）。验证：构造一个 `metadata.paused=true` 的公开 agent，断言目录条目**无** `chatable` 字段；置回未暂停 → `chatable: true`（前提是补贴/主人池有一档开放，否则两态都应为无标记——两个对照都要跑）
- [x] 2.6 **两面一致断言**：同一 agent 的目录 `chatable` 与 `GET /chat/:slug/status` 的 `chatAble` 必须相等，覆盖「暂停」「未暂停且有额度」「未暂停且无额度」三态。**注意：这条只能在单测里证红**——线上 18/18 两面一致（补贴全开、无暂停 agent），撞不到；必须构造 `metadata.paused=true` 的假 registry entry 才能复现。验证：三态各一条断言绿；把 2.5 的修复回退（改回写死 `paused: false`）→ 暂停态那条必须红

## 3. 冻结「标签 vs 准入」（不改数据源）

- [x] 3.1 **先证明事实**：`grep -n "app.get(\"/api/" ../paas/facet/supply-catalog.js` 只有三个端点（species / facades-catalog / data-anchors-catalog），确认无 pack 投影端点；`grep -n "loadListedPacks" ../paas/facet/marketplace-json.js` 确认市场面唯一入列规则。结论写进 change 的 `evidence/`（`curation-source.md`）：`category`/`featured` 的唯一存储源是 `packs` 表两列，`/api/packs` 是它的读面。验证：两个 grep 的输出与结论一致
- [x] 3.2 门面**不读**运营白名单：断言 `services/wanxing-facade/` 里 `FACET_MARKETPLACE_PACK_IDS` 零命中；新增一条单测——设置该 env 后目录条目数与不设时相同。验证：`grep -rn "FACET_MARKETPLACE_PACK_IDS" services/` 零输出；单测两次数目相等
- [x] 3.3 未策展的部署仍在列：构造一个 `category=""` 且 `featured=false` 的已部署公开 agent，断言它出现在目录里、无 `category` 字段、`featured` 缺失。验证：单测绿；反向对照——把它改成 `visibility=private` 则消失（证明是可见性在过滤，不是策展）
- [x] 3.4 标签值与市场面一致：取一个真实策展过的 pack，比对 `/api/packs` 行的 `category`/`featured` 与目录 entry 上的同名字段，逐值相等并记录快照到 `evidence/curation-alignment.json`。验证：文件内两行值相等
- [x] 3.5 无自创策展：`grep -rn "featured\|category" services/wanxing-facade/` 人工过一遍，确认没有从 name/tags/badge 推导策展的路径（`a2a.js` 的 `cur.map.get(...)` 是唯一的取用点）。验证：grep 结果与结论写进 evidence 文件

## 4. 第五条借用边界入册

- [x] 4.1 自助通道未配置时的响应必须指名缺失变量（`FACET_BASE_URL` / `FACET_INTERNAL_TOKEN`）。验证：单测分别在缺 url、缺 token 两个用例下断言 503 且响应体含变量名；**不得**返回 `[]`
- [x] 4.2 `wanxing-borrowed-contracts` 的变量表补齐第五条，并按「边界 × 组件族」列出 facade 与 observer 两套 registry 变量族。验证：`openspec show wanxing-borrowed-contracts --type spec` 里五条边界与两套变量族都能读到
- [x] 4.3 变量表可执行化（只查「表里写的名字代码里确实存在」这一个方向）：新增一条测试，从 spec/README 的表中抽出变量名，断言每个名字在源码里至少被读取一次（防止表里留死名字）。反方向（代码里出现但不进表）由姊妹 change `unify-wanxing-shared-semantics` 的 `env.js` 检查负责，此处不重复。验证：故意在表里加一个不存在的变量名 → 测试红

## 5. web 面状态徽标

- [x] 5.1 `CatalogView.jsx` 每卡渲染状态徽标（`serving`/`idle`/`paused`/`unknown` 四种视觉区分，`unknown` 用中性色而非绿色）。验证：`test/` 下渲染测试喂四态夹具，断言四种徽标文案各不相同且 unknown 不含 "serving" 字样
- [x] 5.2 全 `unknown` 时渲染页级陈旧提示（带 `status_as_of`）。验证：喂全 unknown 夹具 → 提示出现且含时间戳；喂混合态 → 提示不出现
- [x] 5.3 页头/说明文案声明「已部署实例视图」定位，与市场目录区分。验证：断言页面 heading 或说明里出现该表述；同时 `grep -c "市场" CatalogView.jsx` 为 0（避免与供给域措辞撞车）
- [x] 5.4 构建通过：`npm run build`（或仓库既有构建脚本）成功且产物含新文案。验证：`grep -o "实例" dist/assets/*.js | head` 有命中

## 6. 消费侧校验（跨仓，由 paas 仓 change `retire-wanxing-twin-face` 承接）

- [x] 6.1 paas 仓 vendor 一份契约副本到 `facet/contract/wanxing-public-api.v1.json`（内容逐字节相同）。验证：`shasum` 两文件一致
- [x] 6.2 `paas/facet/supply-catalog.js` 的 facade 投影按契约做形状校验（缺 `slug` 或 `status` 类型不对 → 该条丢弃并计数，不静默）。验证：paas 侧单测喂畸形条目 → 丢弃计数 +1 且响应不含该条
- [x] 6.3 三个消费者各一条最小形状断言：`/agents`（脊柱）、`/ops/usage`（`fleets.js`）、`/fleet/v1/board`（`ops-console`）。验证：各自单测在本仓跑绿
- [x] 6.4 **识律（跨仓 `fd-lex`）**：把 `web/src/console/WanxingCopilot.tsx:16` 的 `WANXING_ORIGIN` 常量改为从宿主部署配置读入（构建期变量或运行时注入，二选一并在 change 内记理由）；`copilot.js` 加载失败时给出可见提示而非静默。验证：改配置值即可指向另一个 origin 且副驾仍能挂载；把 origin 指向一个不存在的域 → 页面出现可见错误提示（`data-wanxing-copilot-error` 或等价物）
- [x] 6.5 **柏讯（跨仓 `fd-wire`）**：不改行为，只补一条读契约的测试——按 `fd_wire_api/demands/wanxing.py` 头注释冻结的形状断言回执字段（`message_id`/`idempotency_key`/`reply_excerpt`）与错误码映射（401→`unauthorized`、403→`forbidden`、非 JSON→`protocol`）。验证：改契约里某字段名 → 该测试红
- [x] 6.6 **萬星运维 MCP（跨仓 `wanxing-ops-mcp`）**：补一条响应形状断言（`/agents` 条目字段、agent-card 字段、A2A 回执）。注意它同时读**两个面**（萬星 facade 的公开面 + 壹座 packs 的部署者管理面），测试要把两侧分开标注，避免以后误以为管理动作在 facade 上。验证：两面的断言各自独立可红
- [ ] 6.7 **数据工厂（跨仓 `fd-industry-data`）——已断的链要么修要么正式退役**：spider-heal 不在门面 18 个 public agent 中，工单投递 `404 AGENT_NOT_FOUND`（2026-11-08 实测，记录在 `config/alert-selfcheck-known.json:5`）。二选一并落账：(a) 把 spider-heal 重新部署为门面公开 agent 并恢复投递；(b) 正式退役该通道，删代码与 `WANXING_SPIDER_HEAL_*` 变量，只留邮件通道。验证：选定方案后，`scripts/alert_selfcheck.py` 的「已知不修」条目消失（a 则是投递成功，b 则是代码移除），并顺手把记录里拼错的 `/api/wangxing/` 一并纠正
- [x] 6.8 **两个写入口的一致性**：断言门面 `console.js setPaused` 与 `paas/lib/agent-serving.js setAgentPaused` 对同一 agentPath 产生相同的 registry 结果（同一 `metadata.paused` 语义、`paused=false` 时删键而非置 false）。真正的收敛归 `unify-wanxing-shared-semantics`，此处只要一条跨仓一致性断言防漂移。验证：任一侧改动（如把删键改成置 false）→ 断言红

## 7. 收口

- [x] 7.1 `openspec validate close-wanxing-domain-linkage --strict` 通过
- [x] 7.2 `docs/wanxing-serving-api.md` 补「实例状态口径」一节：四态语义、7 日活跃口径、`unknown` 是合法终态、**不是 SLA 承诺**
- [ ] 7.3 生产核对（出片后）：`curl -s https://wanxing.finddatatech.cloud/api/wanxing/v1/agents | grep -o '"status":"[a-z]*"' | sort | uniq -c` 出现非 unknown 的分布；谦面 `/api/facades-catalog` 同一 slug 的 `status` 与萬星一致

---

## 实测补记（2026-11-13）

**2.4 本地实探（真进程，非单测）**：桩 registry + 桩 packs 起在 3191，真跑
`node services/wanxing-facade/index.js`（WANXING_PORT=3199）。读数：

| 场景 | 结果 |
|---|---|
| 未暂停、7 日 0 回合 | `status: "idle"`，`status_as_of` = 快照时刻（UTC） |
| `metadata.paused: true` | `status: "paused"` —— **暂停真的透传了**，不再是写死的 false |
| 无额度/无补贴 | 两条都**没有** `chatable` 键（诚实的"不可聊"） |
| 顶层键 | 只有 `agents`（2.3 的附加不改形状成立） |
| 部署源不可达 | `503` + `DEPLOYMENT_SOURCE_UNAVAILABLE`（**不是**条目里的 `unknown`） |
| 缺 `SUB2API_BASE_URL`/`PACKS_INTERNAL_BASE_URL` | 拒启并点名两个变量 |

**与任务原文的偏差**：2.4 原文写「hard-stale 重探得到 `unknown`」。按 design D2 的
最终口径，硬陈旧是**目录 503**（`DEPLOYMENT_SOURCE_UNAVAILABLE`），`unknown` 是
**消费方**的兜底而不是门面编出来的值——否则"陈旧"与"没报状态"两种事实会同形。
spec delta 已按此口径改，实探结果与之相符。

**踩到的两个假读数**（都记下来，免得下次重犯）：
1. 第一次桩把 registry 路径写成 `/packs/...`（真路径是 `/api/agents/packs/...`），
   落到通配分支拿回 `metadata: {}`——paused 条目显示成 `idle`。桩自己也要对准路径。
2. 第二次"重探"命中的是**旧进程**：新进程 EADDRINUSE 直接退了，我读到的还是旧
   读数（时间戳几乎没变）。`pkill -f "WANXING_PORT=3199"` 匹配不到（env 不在
   cmdline 里）——改正后 `status: paused` 才出现。

## 跨仓三件实测（2026-11-13，均在各自仓的工作树里完成、**未代提交**）

**6.4 识律**：`web/src/console/WanxingCopilot.tsx` 的硬编码 `WANXING_ORIGIN` 抽到
`web/src/console/config.ts`，读 `import.meta.env.VITE_WANXING_ORIGIN`（照抄该仓
`VITE_API_BASE` 的构建期惯例），默认值逐字不变 `https://wanxing.finddatatech.cloud`。
103 测试通过（+2）、`npm run build` 通过、lint 0 error；红证=默认值末尾加一个字符
→ 2 failed，还原后 diff 为空。**遗留**：私有环境需在构建镜像时给
`VITE_WANXING_ORIGIN`（该仓 Dockerfile 对 `VITE_API_BASE` 也是纯构建期注入，未加 ARG）。

**6.5 柏讯**：新增 `api/tests/test_wanxing_receipt_contract.py`，断言「柏讯读的每个
回执字段契约都声明了」。**它一落地就是红的，而且红得对**：柏讯读 `result.parts`、
`parts[].kind`、`parts[].text`、`result.messageId`，契约里 `result` 只有
`{"type":"object"}`。已在 fd-wanxing 侧补齐（提交 `41ee375`，纯附加不升 rev），
补完这条测试**测试一字未改即绿**；再从契约里删掉 `messageId` → 它点名
`result.messageId`，还原后 diff 为空。

**6.6 萬星运维 MCP**：新增 `tests/test_contract_shape.py`（19 条），按四个面核对
本仓冻结字段集 ↔ 契约：`/agents` 17 字段与 `catalogEntry` **完全一致**、`status` 枚举
恰为四态；信封 5 字段与 `agentsResponse` 一致；A2A 回执与 `turnReceipt` 一致；
`/fleet/v1/board` 13 字段（含 runners/lag/settled/wake 嵌套）与 `fleetBoardResponse`
一致。两次独立注入各红、还原后 sha256 一致。**记名缺口（未修）**：契约没有
`agentCard` 定义，卡上的 `provider/url/default_input_modes/default_output_modes/
preferred_transport` 五个字段在任何 def 里都不存在；另契约 `facets` 缺门面实际会发的
`facets.clusters`（本 MCP 不请求 facets，故未红）。该测试把空洞冻结为
`AGENT_CARD_NOT_IN_CONTRACT` 并在契约补上定义时主动变红、要求收窄白名单——故留着是安全的。

**未做**：三处改动都停在各自仓的工作树里（fd-lex 在 `feat/line-token-verify` 上、
fd-wire 与 wanxing-ops-mcp 在 `main` 上，均非本 change 的仓），按多会话协定不代提交。

## 6.7 证据（2026-11-13 只读实探，供裁决）

`GET https://wanxing.finddatatech.cloud/api/wanxing/v1/agents` → HTTP 200，**18 个条目**，
其中 **0 个带 `status`**（本 change 未出片，符合预期），slug 全列如下（无一含 spider/heal）：

```
packs-6kdskgmb-…-data-scout            packs-ut_bjmuw5kxad83kimpmlg-reception
packs-xfyxvzonqfelnfigm0djvw-lex-console-copilot
packs-_fn7pti9th5jmg3ynqut0w-pack-wire-strategy-lab
packs-_vcfzzuxpgkirsj5pozigg-builder
packs-btnrv2p_jhmczqqxcf0gia-intro-{facet,guide,lex,wire,yizuo}
packs-egayyoazvtf0fwllvagaqa-pack-wire-{macro-analyst,valuation-analyst}
packs-ev5e51eth7e5mcvydrl9rg-market-flash-briefer
packs-i262i0tuwtf9wslex12cow-mission-planner
packs-nol2xkatzp2kierrc_gtka-pack-wire-adaptive-rotation-analyst
packs-qnhd7b3j1-hkddkzzq_fuq-doc-report-writer
packs-thd65-7sfbt_z0kftvhgiw-brief-writer
packs-wqpd5rpcfl3qihg6oldamg-pack-wire-decision-review-analyst-d1da519d4
```

柏讯侧 `api/fd_wire_api/demands/wanxing.py:40` 的缺省值写死为
`packs-kkcie7nlrhluo4likpnn0w-spider-heal` —— 该 slug **在门面上不存在**，所以快车道
按缺省配置投递必然 404。该通路由 `WANXING_CALLER_KEY` 的存在决定是否可用（未配时
报"未配置"而不是发请求），因此现状是"被礼貌拒掉"而不是"静默失败"。

**两个选项（一句话可决）**：
1. **退役**：撤掉快车道与其缺省 slug（工单仍走舰队拉取通道，零外部凭据那条）。
2. **保住通道、去掉假缺省**：删 `WANXING_AGENT_SLUG_DEFAULT`，把 slug 变成必填 env，
   未配即"未配置"——今天的事实是不指名就没有可投的 agent，缺省值只是把 404 推后一层。
   若之后真部署 spider-heal，配一个 env 就恢复，不需要改代码。

我没有替这个决定动手：它改的是柏讯的生产行为，且"修（补部署）"是产品决定。
