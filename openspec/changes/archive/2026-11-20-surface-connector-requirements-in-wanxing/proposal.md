# Proposal

## Why

萬星是「agent 作为服务」的**部署面**，但今天它对**外部系统依赖**完全失语。一个部署在萬星控制台上看起来
健康（状态徽标绿、turns7d 正常），却可能在每一次要碰订单/库存/ERP 的回合上都失败——因为它的连接器
绑定没接通。这个事实**只活在壹座设置页深处**（绑定账本），而部署者判断「这个 agent 能不能真跑」的
地方是萬星。

两侧的数据都已在手边，一个都不需要新契约：

- **声明面**：`packsInternalFetch('/api/packs/:id')` → `manifest.connector_bindings`（每条含 `key` /
  `provider` / `optional`）。`fd-wanxing` 已经在用同一个 `packsInternalFetch`（`routes.js:382` 的
  `packsDetailFetch`）。
- **接通面**：`registryFetch('/api/agents/:path')` → `entry.metadata.connector_bindings`。paas 的
  `lib/agent-serving.js:896` 是 `metadata: descriptor`，而描述符里 `connector_bindings` 只带
  `key / serverName / url / secretName`（`:392`）——**是已铸成功的绑定，不是声明**。萬星已经在读这个
  entry（`a2a.js:349`）。

所以「缺哪一条」= 声明集合 − 接通集合，一个 join 就能算出来，**不需要 paas 改任何内部投影**。

第二处失语在运维面：门面在访客身份登记失败时会记一条 `connector_identity_unregistered` 事件
（`services/wanxing-facade/chat.js:732`），fleet-observer 也已接受这个 kind（`store.js:54`），但
**OpsView 只按原始 kind 打印 payload**——运维看不出「这是登记链断了，连接器调用会被拒」，也看不出
该找谁。

## What Changes

- **`publicConnectorFacts(entry, manifest)`**：在萬星侧把「声明」与「已接通」合成一份投影，随
  `/api/wanxing/v1/agents` 与单 agent 卡片一起下发（additive 键，未知时缺席而非零）：
  `{required: N, optional: M, wired: K, missing: [key…], unmapped?: …}`。
- **AgentDetailView 新增「外部系统」段**：需求 N · 已接通 K · 缺（M 条，标明必需/可选），缺的行回链
  壹座连接页（`?panel=connector`）；未声明时显式写「未声明」，不渲染 0。
- **OpsView 时间线为连接器身份事件给人话**：`connector_identity_unregistered` 渲染为「访客身份登记
  未完成——本回合的连接器调用会被拒」，并把 `code`/`tier` 铺开；其余 kind 保持原样。
- 不改 paas、不改连接器、不新增环境变量、不新增路由。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-web`: 「The public catalog page lists agents for humans」与 agent 详情补一条——每个部署
  SHALL 携带它的外部系统依赖投影（声明/已接通/缺失），详情页 SHALL 呈现该段并以「未声明」区别于
  「零需求」；`fleet-observability`/运维视图补一条——连接器身份登记失败事件 SHALL 在时间线里以可读
  语义呈现，而非原始 kind。

## Impact

- `services/wanxing-facade/a2a.js`：新增 `publicConnectorFacts()`；`/agents` 与 `publicCard` 各增一段
  投影；新增一次按 packId 的 `packsDetailFetch` 读取（已有缓存/cadence 语义沿用，失败降级为「未声明」）。
- `services/wanxing-facade/env.js` / 借用契约表：**不改**（packs/registry 两条边界都已登记）。
- `wanxing-web/src/views/AgentDetailView.jsx`：新增一段。
- `wanxing-web/src/views/console/OpsView.jsx`：事件行按 kind 分支渲染（仅新增一个 kind 的可读文案）。
- 不改：paas 内部投影、连接器、fleet-observer 的 `EVENT_KINDS`、任何计费/准入路径。

## Non-goals

- **不把「能不能跑」折算成健康徽标**。健康态已有定义（`fleet-observability`: ok/degraded/silent/
  paused/failing，由回合结果派生）。连接器缺失是**部署配置缺口**，不是运行故障；把它塞进健康态会让
  「全败」与「从未调用」两种完全不同的原因撞成同一个红点。它是详情页的一段事实，不是徽标。
- 不在萬星复制一份 provider 目录或可视化连接器界面的细节；深链回壹座/连接器。
- 不改绑定账本的六态词表；萬星这侧只呈现「需求 / 已接通 / 缺」三件，缺一条的具体修法仍由壹座回答。
- 不为 `connector_identity_unregistered` 加保留策略或新存储——它已存在事件流里。
