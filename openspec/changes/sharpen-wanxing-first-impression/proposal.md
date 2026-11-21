# Proposal

## Why

线上目录 27 个公开 agent 里 **20 个是 `turns7d: 0`**，而首屏（`#/` 的 6 张卡）与目录第一页拿的是
**registry 顺序**——首屏 6 张里 5 张是无差别的空白卡，第一张还带着 `security-pending` 标签。
`status-facts.js` 已经把「一个 agent 是什么状态」统一成七种事实，但**没有任何东西回答「先看哪个」**：
状态是事实，顺序是判断，而判断这一层不存在。结果是访客落地三秒内看到一个「什么都还没发生」的页面。

同一批勘察还发现一处纯隐藏功能：`#/collections`（部署者的集合 / 可整体部署的公开套装）全功能实现，
但导航里没有入口，只有部署向导里一条「我的集合 →」（`FleetView.jsx:850`）。用户不点开部署向导就永远
不知道它存在。

## What Changes

- **facade 目录新增 `sort=activity` 查询参数**：精选 → 在役 → 尚无调用，组内按 `turns7d` 降序、再按名称。
  **缺省行为不变**（仍是 registry 顺序），`sort` 只影响被显式请求的响应。
- **首屏与目录第一屏改用它**：落地页取 6 张、目录页首屏取 12 张都带 `sort=activity`。分页在服务端，
  所以排序必须发生在服务端——客户端排一页没有意义。
- **导航补「集合」入口**：`ENTRIES` 与顶栏各加一条，指向已存在的 `#/collections`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-facade`: 公开目录的 `GET /agents` 增加 `sort` 参数与其排序语义。现有 requirement
  「The public catalog serves server-side facets with curation and activity signals」扩写，
  不改它已定的任何既有行为（无参数调用形状不变）。
- `wanxing-web`: 首屏与目录的取数带上 `sort=activity`；站点导航增加集合入口。对应 requirement
  「The public intro view is the default landing」与「The public catalog page lists agents for humans」。

## Non-goals

- **不改缺省排序**。四个外部消费者（谦面供给脊柱、壹座 ops-console、柏讯工单链、识律控制台）读的是
  无参数调用；把缺省改成 activity 等于悄悄换掉他们第一页的内容。要换是另一个决定。
- **不动卡片视觉**。DESIGN.md 的「一枚主徽标、空白是诚实的信息」是对的，问题不在卡长什么样，
  在卡的**先后**。「尚无调用」的卡仍然完整呈现，只是不占据第一屏。
- **不收运维面的零值 chip**。那条 `serving 0 / resident 0 / …` 枚举行是规格要求的、与 agent 状态
  词汇刻意区分的一套话；把它折叠会削弱「这一轮谁在跑」的可读性，收益不抵。
- **不做第七章·刀二**（官网萬星线页入场 strip）。它在另一个仓、另一个 change。
- 不动计费措辞、不动 `#/chat` 登录门、不动七事实表。

## Impact

- `services/wanxing-facade/a2a.js` — 目录路由的列表排序。
- `scripts/test-public-contract.mjs` / `scripts/test-wanxing-facade.mjs` — 新增排序断言；既有
  「无参数形状不变」断言必须继续通过。
- `wanxing-web/src/views/IntroView.jsx`、`CatalogView.jsx` — 取数 URL 加一个参数。
- `wanxing-web/src/App.jsx` — 导航入口。
- `wanxing-web/test/views.test.jsx` — 导航与首屏取数的断言。
- 无新依赖、无 schema 迁移、无 env 变化。
