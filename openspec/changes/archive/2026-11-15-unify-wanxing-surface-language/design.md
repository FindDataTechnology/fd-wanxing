# Design — 展示面语言统一

## D1 事实表与优先级链：为什么是这一条链，而不是「两张表并排」

三套词汇今天各自成立，但互相不知道对方。把它们合成一条链的唯一原则是：
**读者在卡面上最需要立刻知道的那件事排在前面**。

```
已暂停 > 状态未知 > 持续失败 > 部分失败 > 该跑没跑 > 尚无调用 > 在役
  |          |           |          |          |         |        |
运维动作    数据不可信   钱在烧     部分受损    该动没动   正常静默  正常
```

设计裁决：

1. **已暂停排最高**，即使同时 failing——暂停是管理员主动动作，故障徽标会让读者去排障。
2. **状态未知压过一切故障**：数据不可信时报告故障是在编故事。这一条与 `fleet-observability`
   的「缺席信号不得渲染成健康」同源，只是反过来也成立——缺席信号也不得渲染成故障。
3. **该跑没跑压过尚无调用**：两者都是零回合，区别在「有没有声明节奏」。这一分工
   `flag-stalled-rhythm-agents` 已经建立（`HealthBadge` 的 silent 分支，`shared.jsx:50`），
   本刀只是把它提到主徽标层，不再让「运行中」压在它上面。
4. **在役排最后**：它是默认态，占位意义大于信息意义。

## D2 主徽标唯一性：怎么在 44K 的 FleetView 里做到而不重写它

现状的重复来自两处独立渲染：`FleetView.jsx:404` 的 `d.paused` 药丸，和 `shared.jsx:29` 的
`HealthBadge` 组件。它们各渲染各的。

落法：

```
新增 wanxing-web/src/status-facts.js（唯一新增模块）
  FACTS = { paused, unknown, failing, degraded, stalled, unused, live }
  factOf({ status, health })  -> FACTS 之一（按 D1 链）
  badgeFor(fact)              -> { label, cls, title }
  factLabel(fact), isHealthy(fact)

四个消费面各删掉自己那一套：
  CatalogView.STATUS_UI        -> 删；改 statusBadgeFor() 走 badgeFor(factOf(...))
  AgentDetailView 的「可对话」旁 -> 补主徽标（今天无状态徽标）
  FleetView 的 d.paused 药丸   -> 删；shared.jsx 的 HealthBadge 塌进 badgeFor
  OpsView 的 states 顶行        -> 枚举键过 factLabel，title 留原枚举
```

`shared.jsx` 的 `HealthBadge` 保留导出名与 `data-testid`（`fleet-health-<slug>`），内部改为
调 `badgeFor`——**测试标识不变**是这一刀能安全落在 44K 文件上的前提。

`status-facts.js` 是纯函数模块，零依赖，可被 `node --test` 直接测——这是本刀唯一新增的可测单元，
也是唯一值得测的东西。

## D3 假零：三种状态，三种脸

```
summary === null            -> 占位（…），三格各自占位
summary 有值但三项全 0      -> 一句「尚无调用记录」，跨三列
summary 有值且非全 0        -> 三格正常数值（个别格为 0 时照常显示 0）
```

第三种的「个别格为 0」必须照常显示——否则「有回合但零分钟」这种真事实会被空态吞掉。判据是
**整组是否全零**，不是单格。

规格原文「placeholder, never fake zeros」已经覆盖前两种；本刀补的是第三种形态从未存在过。

## D4 运维板口径脚注：两个数字为什么可以不相等

```
页脚状态条：GET /api/wanxing/v1/status -> agents.value   （公开目录口径：公开且已部署）
运维板     ：GET /api/fleet/v1/board    -> agents_total   （观测口径：窗口内被观测到）
```

生产实测同屏：`0 agents` vs `18 个 agent 在役`。这不是 bug，是两个 collection
（`services/fleet-observer/observer.js:701` 的 `agents.size` 来自观测事件）。

落法：板顶行旁一句 `title` + 可见小字，措辞固定为
「板统计窗口内被观测到的 agent；与页脚『N 个 agent 在役』不同口径，两者不等不是故障」。
不把两个数字强行对齐——对齐需要改观测端，超出本刀。

## D5 操作分层：为什么是「更多」而不是重排

七个按钮里真正高频的只有两个：暂停/恢复、对话。其余五个都是低频管理面。分层方案：

```
卡面保留：  [暂停/恢复]  [对话 →]           ← 高频 + 主转化
更多入口：  配置 记录 记忆 额度 嵌入 允许清单
```

用 `<details>` 而不是新组件——原生可访问、零依赖、无状态管理。这符合本仓既有做法
（卡面上的 slug 折叠已经用 `<details>`）。

**每个按钮的 onClick、端点、testid 一字不改**，只换容器。验收靠 testid 清单逐个点开。

## D6 标签字典：字典在 web 侧，不在数据侧

标签源头是 pack manifest（paas 侧），wanxing 只透传。本刀不碰源数据，只在**渲染时**翻译：

```
const LABEL_DICT = {
  "wire": "柏讯", "lex": "识律", "facet": "谦面", "yizuo": "壹座",
  "security-pending": "待安全复核", "M2": "里程碑 2", ...
};
label(t) => LABEL_DICT[t] ?? t        // 未命中原样保留
```

裁决：**字典放 web 侧**而非生产侧，因为它是「怎么对访客说」而不是「数据是什么」——生产侧改它
会污染 registry 契约；web 侧改它零风险且随时可扩。

`security-pending` 译「待安全复核」：保留「这是个门」的事实，但不让访客读到英文 slug。

## D7 无示例体态：删掉入口，不是补占位

今天 `examples` 为空时卡片整段不渲染（`CatalogView.jsx:186` 的 `(a.examples ?? []).length > 0`），
详情页同理——所以并不是「残缺」，而是**入口彻底不存在**。

真正的体态问题是：`skills` 为空时卡片底部那个 `<details>` 打开是「（未声明）」——这是一个
只在打开后才发现的残缺。落法：`skills` 与 `slug` 的折叠在两者都空时不出渲染，改成卡面一句
「对话即试用」的引导。

不补占位示例。理由：编造的示例问句会把访客导向 agent 答不了的路径，比没有示例更伤。

## D8 规格修正：三 tab -> 五 tab

`wanxing-web/spec.md:402` 的要求文本与 `ConsoleView.jsx:22` 的 `TABS` 已分叉（devices、stats 是
后加的）。修正为五 tab，并把 `#/console/devices`、`#/console/stats` 纳入保留子路由约定。
场景名 `The three tabs carry the console's surfaces` 保留历史称谓（改场景名会让 archive 拒绝，
且它对读者无害），在场景正文里写明五 tab。

## 风险与验收

| 风险 | 缓解 |
|---|---|
| FleetView 44K 重排是最大 diff | 只动卡片顶行与操作区两处；testid 清单逐个点开；不重构其余 |
| 状态映射改错导致「坏的看起来好的」 | `status-facts.js` 单测覆盖七种事实 + 优先级冲突组合；规格的四个场景即测试用例 |
| 标签字典漏译 | 未命中原样保留（fail-open 到原文），不会静默消失 |
| 运维板口径脚注被读成免责声明 | 措辞固定、写在数字旁而不是页脚 |

出片验收：生产四点走查（目录/详情/舰队卡/运维板），加一条「人工造一个 failing agent 看是不是
只出一枚徽标」的反向验证——这是本刀唯一一条不能用静态断言证明的验收项。
