# 萬星展示面语言统一（unify-wanxing-surface-language）

## Why

萬星对「一个 agent 现在是什么状态」有三套说法，而它们说的是同一组事实：

- 门面 `statusFor()`（`services/wanxing-facade/core.js:46`）产出 `paused | unknown | serving | idle`，其中
  `serving` 的真实语义是「近 7 天有人调用过」、`idle` 是「近 7 天无人调用」——不是「运行中/空闲待命」。
- 观测面 `health` 把同样的事实叫 `ok | silent | paused | degraded | failing`（外加 `stalled`）。
- 控制台舰队卡（`wanxing-web/src/views/console/FleetView.jsx:404`）只读 `d.paused`，自己再造一套
  `运行中 / 已暂停`，**完全无视前两者**。

后果不是口味问题，是同屏自相矛盾：一个「持续失败」的 agent 在卡片上同时戴着绿色的「运行中」
和红色的「持续失败」两枚徽标。七种可区分的事实里，有五种的控制台呈现都是绿底「运行中」：

| 事实 | 门面 `status` | 观测面 `health` | 控制台卡片今天 | 应有说法 |
|---|---|---|---|---|
| 管理员暂停 | paused | paused | 已暂停 | 已暂停 |
| 快照过期/未上报 | unknown | （缺字段） | **运行中** | 状态未知 |
| 有调用、全失败 | serving | failing | **运行中** | 持续失败 |
| 有调用、部分失败 | serving | degraded | **运行中** | 部分失败 |
| 零调用、声明了节奏却没跑 | idle | silent + stalled | **运行中** | 该跑没跑 |
| 零调用、无人使用 | idle | silent | **运行中** | 尚无调用 |
| 有调用、正常 | serving | ok | 运行中 | 在役 |

同一批事实还制造了另外三处读不懂：

1. **假零**：舰队卡三列 `近 7 天回合 0 / 近 30 天分钟 0 / 近 30 天结算 $0.00`——「新部署」与
   「没人用」与「坏了」在界面上是同一张脸。规格早有「不得把缺失信号渲染成健康」的原则
   （`fleet-observability` 的 health 语义），但展示层没有对应的「尚无调用」形态。
2. **运维板顶行是未翻译的枚举直出**：`serving 0 resident 0 paused 0 starting 0 draining 0 warm 0
   unknown 0`，同屏其余全是中文；而同一页脚的状态条宣称「18 个 agent 在役」——板的
   `agents_total` 只统计被观测到的（`services/fleet-observer/observer.js:701`），界面上没有一句话
   解释这两个数字为什么不相等。
3. **访客面的标签是原始 slug 与中文混排**：`security-pending`、`wire`、`lex`、`M2` 和 `柏讯`、
   `量化`、`文档` 平铺在一起。`security-pending` 尤其糟——访客看到的是一个无法解释的词。

还有一处**已经发生**的规格漂移：`openspec/specs/wanxing-web/spec.md:402` 仍写「控制台分为
舰队/任务/运维三个 tab」，实装已是五个（`devices`、`stats` 后加，`ConsoleView.jsx:22`）。展示契约
的文本真源与代码已经分叉，而这一条正是本次所有展示工作的落点。

为何现在：跨线副驾（`spread-line-copilot`）要把万星的状态词汇带到四条宿主线的页面上。**如果先铺开
再统一，就会把一个有歧义的词汇复制五份。**

## What Changes

**① 状态事实单源（跨面，一条优先级链，每个 agent 只出一枚主徽标）**

- 新增一张跨面事实表与优先级链：`已暂停 > 状态未知 > 持续失败 > 部分失败 > 该跑没跑 > 无流量 > 在役`。
- 每个 agent 在**任一面的主徽标位置只出现一枚**，禁止两枚徽标并列（今天的「运行中 + 持续失败」）。
- 目录、详情、舰队卡、运维板共用同一份映射；门面 `status` 与观测面 `health` 的语义差异在映射里
  一次消化，**不改门面的字段形状**（API 兼容，入向消费者不动）。
- `serving`/`idle` 的展示措辞改成它们真正的意思（「近 7 天有调用」「尚无调用」），不再借用
  「运行中/空闲」这两个会被读成「进程在跑/进程待命」的词。

**② 假零语义化**

- 舰队卡最近活动三列：观测面未返回时不渲染假零；「有信号但全是 0」时渲染一句
  「尚无调用记录」而不是三个 0。
- 消耗视图与运维板的空态沿用同一措辞族。

**③ 运维板读得懂**

- 顶行状态枚举换成中文主徽标词汇，保留原始枚举在 `title` 上（排障可读，访客不撞）。
- 增加一行口径脚注：板统计的是「窗口内被观测到的 agent」，与公开目录在役数不是同一口径，
  两个数字不相等时不是故障。
- 「窗口内无 runner_stats / 无任务」这类空态给出下一步（去哪看、什么时候会有）。

**④ 舰队卡操作分主次**

- 七个同权重按钮（暂停/配置/记录/记忆/额度/嵌入/允许清单）分成「主操作 + 更多」：
  主操作留在卡面，其余收进卡内「更多」菜单；**每一个 panel 的行为、端点、testid 不变**。

**⑤ 访客面**

- 目录卡与详情页的状态徽标改用 ① 的词汇（今天目录用 `空闲`、详情页只有「可对话」）。
- 标签：已知内部枚举（`security-pending`、`wire`、`lex`、`facet`、`yizuo`、`M2` 之类的线标记）
  经一张人读字典渲染；字典未命中的标签原样保留，不吞掉。
- 无示例的体面态：`examples` 未声明时，卡面与详情页不留空段落、不显示「（未声明）」式的残缺感，
  而是给一句可执行的下一步（直接对话／看文档）。**试问入口的实际填充不在此刀**——它需要
  pack 的 serving 契约声明 `card.examples`，属于 paas 侧（见 Impact 的前置依赖）。

**⑥ 规格补回现状**

- `wanxing-web` 的控制台 IA 要求从「三 tab」改为「五 tab」（fleet / missions / devices / stats / ops），
  并保留 `#/console/<slug>` 与保留子路由的既有约定。

## Non-goals

- 不动门面 `/api/wanxing/v1/agents` 的字段形状与语义（`status` 四值、`status_as_of` 保持不变）。
  本刀只改**消费侧怎么读**，不改生产侧怎么发——入向契约是 `close-wanxing-domain-linkage` 的地盘。
- 不补 `card.examples` 的数据（paas 侧前置依赖，见下）。
- 不做首访导览/onboarding（没有任何访客流失点数据支撑它，YAGNI）。
- 不引入路由库、组件库、状态管理库；不重做配色。

## Capabilities

### New Capabilities

（无——本刀是对既有展示面的收敛，不引入新能力）

### Modified Capabilities

- `wanxing-web`：新增「跨面状态词汇与主徽标唯一性」「假零语义化」「运维板口径与空态」
  「舰队卡操作分层」「访客面标签人读化与无示例体态」五条要求；并把控制台 IA 要求从三 tab 修正为五 tab。

## Impact

- **纯 web 刀**：`wanxing-web/src/views/{CatalogView,AgentDetailView}.jsx`、
  `wanxing-web/src/views/console/{FleetView,OpsView,StatsView,shared}.jsx`、
  `wanxing-web/src/App.jsx`（如页脚口径脚注需要）、`wanxing-web/test/views.test.jsx`。
- 门面、观测端、部署清单与数据库**零改动**。
- **前置依赖（不在本仓、不在本刀）**：试问入口的实际内容依赖 18 个 pack 在 serving 契约里声明
  `card.examples`，产出点是 `paas/lib/agent-serving.js:254`。按 workspace 约定，paas 改动在
  paas 目录的会话里另起一条 change；本刀只保证「未声明时不难看」，并在 tasks 里登记该依赖。
- 风险面：`FleetView.jsx` 是 44K 单文件，本刀的卡片区改动是其中最大 diff；靠 testid 清单不变 +
  生产走查兜底。状态映射抽成共享模块并配单测，是这一刀唯一新增的可测单元。
- 出片沿 fd-wanxing 标准线：GHA → hkccr → 回灌 ccr `yizuo/wanxing-web` → fd-infra-deploy 滚 tag →
  ArgoCD → 生产四点走查。
