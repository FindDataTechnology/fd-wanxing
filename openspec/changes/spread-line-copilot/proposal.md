# 跨线副驾铺开（spread-line-copilot）

## Why

跨线副驾的能力已经全部建好了：绑定治理面（门面存储 + ops 面板双视角）、公开只读解析端点
（`GET /api/wanxing/v1/lines/:line/copilot`，CORS `*`）、一行 loader（`wanxing-web/public/copilot.js`）、
宿主协议（init/context/identity/intent）、问询卡、匿名双门。规格里这四块都是完整的要求。

**但生产上它只绑了一条线。** 2026-11-15 实测：

```
lex       ready      -> packs-xfyxvzonqfelnfigm0djvw-lex-console-copilot
wire      unbound
yizuo     unbound
facet     unbound
official  unbound
```

而唯一的消费者识律，是靠一段 85 行的手写宿主封装挂上去的
（`fd-lex/web/src/console/WanxingCopilot.tsx:68`）。也就是说：**这个能力到今天为止
只被验证过一次，且验证的方式是 change 当初手写的那一条路径。**

于是在用户面前，同一个产品角色（「这条线的副驾」）仍然是：识律控制台里有一个，
柏讯没有，官网没有，壹座里另有一个不兼容的（paas 的 `CopilotDock`，同源 iframe + 形状解析的
聚焦预设，身份/结算/上下文协议都与萬星 widget 不同）。

能力不缺，缺的是**把它挂上去**。而挂上去需要三个东西，每一样都不是写代码：
绑定（要有人决定哪条线用哪个 agent）、来源白名单（匿名凭据只对登记过的源铸发）、宿主页改动。

## What Changes

**① 三条线先绑上（wire / facet / official），每条线做出一个可对话的副驾 agent**

- 每条线指定（或新建）一个公开、可对话、声明了 serving 契约的 agent 作为该线副驾。
- 经 ops 凭据在既有的「线副驾绑定」面板写入绑定；accent 取该线品牌色；匿名意图按下面 ② 定。
- 绑定前的硬校验：slug 必须在部署台账里真实存在且公开（门面已强制）。
- **官方站点线（official）优先**：它是零登录、纯静态 Astro 站，是匿名车道最有说服力的试金石。

**② 匿名策略按线定，并在控制台显示「意图 vs 生效」的缺口**

- 公开站点线（official、wire 对外面）匿名开；控制台内线（lex 已如此）匿名关。
- 绑定意图与生效不一致时，ops 面板的「缺口 · 匿名未开」标记必须被处理掉，而不是留着当装饰。
- 匿名仍受全局开关与 agent 侧开关两道闸，绑定只是意图（`wanxing-facade` 既有要求，不改）。

**③ 宿主接入改用 loader，不再手写协议**

- 每条宿主页 SHALL 用 `copilot.js` 一行接入（`data-line` + 可选 `data-open`），可选的
  `identify()` / `context()` / `intents` 钩子按需提供；**宿主编写的 postMessage 协议代码为零**。
- 识律那 85 行手写封装在本次一并回收到 loader（它的身份钩子必须保留：宿主自己的 Logto 票）。

**④ 壹座分叉显式登记为切片 5，带明确门槛**

- 壹座 paas 侧仍有一套 `CopilotDock`（同源 iframe + 聚焦预设），与萬星 widget 在身份、结算、
  上下文上不兼容。本刀**不迁移它**。
- 迁移门槛写死：**三线（official / wire / facet）在生产真机跑通「匿名对话 + 问询卡 + 宿主意图」之后**
  才动壹座；迁移本身落在 paas 仓（删 `CopilotDock`、改挂 loader），不在本刀内。
- 登记而不排除：壹座是最终目标，但它是唯一一个「已在役、有真实用户」的宿主，最后动。

## Non-goals

- 不改门面的绑定存储、解析端点、loader、宿主协议的任何行为——它们已是规格里的要求，
  本刀只消费它们。若真机上发现缺陷，修在对应 capability 而不是本刀另开一套。
- 不迁移壹座的 `CopilotDock`（切片 5，门槛见上）。
- 不为四条线新建 agent 人设。若某线没有合适 agent，登记为该线的阻塞项而不是临时编一个。
- 不做跨线统一外观（各线 accent 不同是特性）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-web`：新增一条覆盖要求——每一条对外有页面的产品线 SHALL 有一个可解析的副驾绑定，
  未绑定的线是**可见的治理缺口**而不是静默缺失；宿主页接入 SHALL 经 loader（禁手写协议），
  且加载失败/未绑定时不得留下死卡。

## Impact

- **运维动作**：三条线各一次绑定写入（ops 面板），各一份来源白名单，各一次宿主页改动。无后端代码。
- **宿主仓**（三处小改 + 一处回收）：
  - `fd-official-web`（Astro 静态站）：页面挂 loader 脚本 + 匿名来源白名单加其域名。
  - `fd-wire`（React 控制台/对外面）：挂 loader，可选 `context()` 递当前数据集/页面。
  - `fd-lex`（React 控制台）：把 85 行手写封装回收成 loader（保留 `identify()` 身份钩子）。
  - `paas`（壹座）：**本刀不动**，只在 proposal/tasks 登记切片 5 与门槛。
- **依赖**：`unify-wanxing-surface-language` 应当先落——副驾的状态与措辞要跟萬星展示面同一套词汇，
  否则线页面与萬星自己的目录会对同一个 agent 说两种话。这是顺序依赖，不是技术依赖。
- 风险：匿名车道在公开站点开启后，会真的产生平台补贴成本。缓解：先只在 official 开匿名、
  观察日额消耗，再决定 wire 对外面是否放开。
- 验收：每条线在生产域名上打开页面 → 副驾浮起 → 匿名发一轮 → 收到回复 → 触发一次问询卡 →
  触发一次宿主意图（宿主声明的动词）。四点全过才算该线接通。
