# Design

## D1 声明面与接通面各是哪一份（这是本变更的全部难点）

三個候选里只有一个是对的：

| 候选 | 位置 | 是声明还是事实 | 能否用来算缺口 |
|---|---|---|---|
| `manifest.connector_bindings` | 包版本的清单（`packsInternalFetch('/api/packs/:id')`） | **声明** | 只能答「包要什么」 |
| `entry.metadata.connector_bindings` | 注册条目 = 部署描述符（`registryFetch('/api/agents/:path')`） | **已铸成功的绑定**（paas `lib/agent-serving.js:392` 写的是 `deploymentBindings.granted`） | 只能答「已接通什么」 |
| `connector_binding_ledger` | paas 的 SQLite | 互动授权行的用户级账本 | **不是部署期铸造**，与 `deploy:` 命名空间故意不相交 |

⇒ 缺口 = ②的 key 集合 在 ① 的声明里缺席的那部分。**不需要 paas 暴露任何新字段。**

**一个容易踩的坑**（写进 tasks 的验收）：`mintableBindings()` 的过滤是
`.filter(row => !row.optional && row.status === "satisfied")`——**optional 的绑定永远不会被铸**。
所以「声明了 3 条、其中 2 条 optional、全部未铸」是**正常现象**，不是缺口。投影必须把
`optional` 带进 `missing` 行里，UI 才能说出「缺 1 必需 + 2 可选（可选的不影响部署）」。

## D2 数据从哪来、缓存怎么办

`a2a.js` 已经有两条就绪的通路：

```js
// 声明面（routes.js:382 已注入；cluster 分组在用它，只对多 agent 行取）
packsDetailFetch: (id) => packsInternalFetch(`/api/packs/${encodeURIComponent(id)}`)
// 接通面（a2a.js:349 的 entryFor，已有 60s entryCache）
const entry = await entryFor(dep.slug, dep);   // entry.metadata.connector_bindings
```
- 声明面按 **packId** 取，一次部署只取一次；同一包的多 agent 部署共享结果。用 `Map` 按 packId 缓存，
  与既有 `entryCache` 同一 cadence（60s）。
- 只在 `connector_bindings` 存在时才取详情——今天的产线是 **0 个部署声明绑定**（2026-11-16 实测），
  所以这条路径默认不产生额外请求。先看注册条目有没有 `metadata.connector_bindings` 或
  `metadata.packId` 的下载行，按需取。

**降级**：`packsDetailFetch` 抛（`PACKS_INTERNAL_UNAVAILABLE`）⇒ 键缺席，**不是** `missing: []`。
这条与 `fleet-observability` 的「不可达依赖不伪造状态」同一纪律。

## D3 为什么不进健康徽标

`fleet-observability` 的健康态由**回合结果**派生（ok/degraded/silent/paused/failing）。连接器缺失
的 agent 的回合会失败，于是它**会**自然地落到 `failing`/`degraded`——两种完全不同的根因（模型不通 vs
外部系统没接通）撞进同一个红点。把缺口塞进徽标等于让运维看着红点去查模型。所以：

```
健康徽标   ← 回合结果（已有）
外部系统段 ← 部署配置（本变更）
```
两者并排、互不覆盖。spec 里把这条写成「SHALL NOT 与主状态徽标争夺同一强调级」。

## D4 详情页放哪

`AgentDetailView.jsx` 现有三段（`:206` 是什么 / `:243` 三支柱 / `:299` 现在怎样 / `:322` 怎么接入）。
外部系统段插在**三支柱之后、「现在怎样」之前**——它与三支柱同属「这个 agent 有什么」的层，不属于
「现在怎样」的运行态。

```
[是什么]
[团队能力面 — 三支柱]      ← 既有
[外部系统]                 ← 新增：需求 2 · 已接通 1 · 缺 1（必需）
[现在]
[怎么接入]
```
未声明时该段仍渲染一句「未声明」，理由与三支柱那段一致（`AXIS_TITLES` 上方注释：缺席要显式说，
不能渲染成空盒子）。

## D5 OpsView 的事件行

现状（`OpsView.jsx:512-519`）是纯原始打印：

```jsx
<span className="font-mono …">{e.kind}</span>
<span className="text-slate-500 truncate">{JSON.stringify(e.payload ?? {})}</span>
```
改成按 kind 查一张小表，命中则渲染一句人话 + 结构化字段；未命中走原路径：

```js
const EVENT_COPY = {
  connector_identity_unregistered: {
    text: "访客身份登记未完成——本回合的连接器调用会被拒绝（不回落部署者）",
    fields: ["code", "tier"],
  },
};
```
**只加一个 kind**：不为事件词汇表造一个标签系统，也不改其它行的呈现（spec 有场景钉这条）。

## D6 哪些文件被触碰

| 文件 | 归属 | 动作 |
|---|---|---|
| `services/wanxing-facade/a2a.js` | 本仓 | 新增 `publicConnectorFacts()` + `/agents` 投影 + `publicCard` |
| `services/wanxing-facade/routes.js` | 本仓 | **不改**（`packsDetailFetch` 已注入） |
| `wanxing-web/src/views/AgentDetailView.jsx` | 本仓 | 新增一段 |
| `wanxing-web/src/views/console/OpsView.jsx` | 本仓 | 事件行按 kind 分支 |
| `scripts/test-*.mjs` | 本仓 | 投影单测 + 渲染断言 |

不改 paas、不改 open-connector-mt、不改 env 契约表。

## 风险

- **`entry.metadata.connector_bindings` 只在「部署期铸造成功」时存在**。一个包声明了必需绑定但部署者
  没有连接器账号 ⇒ 铸造失败 ⇒ 键缺席 ⇒ 投影会把它算成 `missing`。**这是正确的**：那条调用确实会失败。
  但它给出的下一跳是「去壹座连接器卡」，而真实修法可能是「部署者先去连接器登录」。UI 文案要宽一点
  （「去凭据修复面」而不是「去连接这条」）。
- **包详情是付费墙/可见性门后的读**：`packsDetailFetch` 用 registry token，私有包也能读。但若某部署的
  包已被下架，详情 404 ⇒ 键缺席 ⇒ UI 显示「未声明」而不是「缺口」。可接受但需在 tasks 里写成已知限制。
- **`optional` 的绑定永不铸造**（见 D1 的坑）：UI 必须把可选缺口与必需缺口分开讲，否则部署者会去修一个
  本来就不会生效的东西。
