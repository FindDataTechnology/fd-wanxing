# Tasks

> 分组独立可验。本仓沿用 paas 的纪律：本机只做静态检查，执行走 CI。

## 1. 投影函数（纯函数优先）

- [x] 1.1 `services/wanxing-facade/a2a.js`：新增 `publicConnectorFacts({ manifest, entry })`，输入声明面
      （`manifest.connector_bindings`）与接通面（`entry.metadata.connector_bindings`），输出
      `{declared, required, wired, missing:[{key, optional}]}`。
      判据：`scripts/test-connector-facts.mjs` 五个用例（全通 / 有缺口 / optional 不计 required 但仍入
      missing / 未声明 → 键缺席 / 读取失败 → 键缺席）。
- [x] 1.2 断言它**不**输出 token / secret 名 / 连接器 url（喂一条带 `secretName` 的注册条目，断言
      投影里没有该字段值）。
- [x] 1.3 `required` 的口径与 paas `mintableBindings()` 一致：`optional !== true` 才计入。判据：与
      paas 的 `binding_required_count` SQL 对照一条同数据用例（同包同一版，两处数字相等）。

## 2. 接到目录与卡片

- [x] 2.1 `/api/wanxing/v1/agents` 的每条 entry 增 `external_systems`（additive，缺席即未声明）；
      `publicCard()` 同样增。判据：无声明部署的响应里**没有**该键（不是 `{}`、不是零）。
- [x] 2.2 声明面按 packId 缓存（与 `entryCache` 同 cadence）。判据：`test-connector-requirements.mjs`
      的「两次目录读只打一次 packs」用例。
      **门槛来自 browse 行**：`connectorBindingCount > 0` 才读详情（paas 已有这个投影，
      add-market-card-connector-signal）。第一版按「部署已出现 connector 迹象」判，被
      `test-wanxing-clusters.mjs` 的「only multi-agent browse rows are detailed」当场抓住——每个部署
      读一次详情破坏了那条既有不变量。改用 browse 计数后**零额外请求**，且门槛不看部署期接线：
      「声明了但一条都没铸」正是本投影要显示的场景，它的注册条目没有任何连接器痕迹。
- [x] 2.3 降级：`packsDetailFetch` 抛错 ⇒ 键缺席（**不是** `missing: []`）。判据：注入抛错的桩。

## 3. 详情页

- [x] 3.1 `AgentDetailView.jsx` 在三支柱之后、「现在」之前新增 `data-testid="detail-external-systems"` 段：
      需求 N · 已接通 K；`missing` 非空时逐条列出并标必需/可选；未声明写「未声明」。
- [x] 3.2 缺口链接回凭据修复面（壹座 `/settings/connections?panel=connector`）；部署未配置该地址时
      只陈述缺口、不给链接。
- [x] 3.3 渲染断言（复用仓库既有的 esbuild + `react-dom/server` 手法）：
      全通 / 有缺口 / 未声明 三种输出**措辞互不相同**。

## 4. 运维面

- [x] 4.1 `OpsView.jsx` 事件行按 kind 查表：`connector_identity_unregistered` 渲染
      「访客身份登记未完成——本回合的连接器调用会被拒绝（不回落部署者）」+ `code` + `tier`。
- [x] 4.2 其余 kind 走原路径（原始 kind + JSON payload），未知 kind 不被吞掉。
- [x] 4.3 渲染断言：同一时间线里混入两类事件，断言前者的可读文案出现、后者的原始渲染不变。

## 5. 收口

- [x] 5.1 `openspec validate surface-connector-requirements-in-wanxing --strict` 通过。
- [x] 5.2 lint / typecheck（CI）。
      全量 `scripts/test-*.mjs` 实跑：364 tests / 356 pass / 8 fail；8 条全在
      `test-wanxing-clusters.mjs`，且用 stash 对照证明**改动前后同为 8 红**（既有失败，非本变更引入）。
      `wanxing-web` 自己的 `npm test` 128/128 绿。
- [ ] 5.3 真机：找一个声明了非 optional 绑定且已部署的 agent（若产线仍为 0，先造一个带 agent +
      facade + connector_bindings 的包，这是 `docs/served-agent-connector-access.md` 记的那条前提），
      核对详情页数字与壹座绑定账本逐条一致。
- [ ] 5.4 真机反证：把该包详情读失败（或包下架），断言页面显示「未声明」而**不是**「全接通」。
