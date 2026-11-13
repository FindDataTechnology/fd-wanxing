# 萬星共享语义收敛（unify-wanxing-shared-semantics）

## Why

萬星有两样东西被复制了太多次，而它们都是**跨仓契约**：

**① 公开 agent 身份（`slugFor`）在两仓活代码里有 9 份，连探针/前端共 12 份，工作区全量 60 处**

下面这份清单是用**表达式本身**（`replace(/^\/+/,…)` 与字符类 `[^A-Za-z0-9._-]+`）扫出来的，不是按 `function slugFor` 数——按声明名数会漏掉内联副本，我为此数错过两次（先说 6 份、又说 18 份，都不对）：

| 位置 | 形态 | 性质 |
|---|---|---|
| `paas/agent-runner/fleet.js:16` | `const` | 活语义 |
| `paas/facet/supply-catalog.js:50` | `export function` | 活语义（谦面脊柱） |
| `paas/web/src/components/packs/PackDetailDialog.tsx:77` | `const wanxingSlugFor` | **活语义，在浏览器里** |
| `paas/gateway/wanxing/core.js:27` | `export function` | 死替身 |
| `fd-wanxing/services/wanxing-facade/core.js:26-27` | `export function` | 活语义（对外路由身份） |
| `fd-wanxing/services/wanxing-facade/console.js:227` | **内联在 map 里，无函数名** | 活语义 |
| `fd-wanxing/services/wanxing-facade/selfservice.js:60` | `const` | 活语义 |
| `fd-wanxing/services/fleet-observer/bookkeeper.js:45` | `const` | 活语义（rollup 身份） |
| `fd-wanxing/services/fleet-observer/observer.js:26` | 函数体 | 活语义 |
| `paas/scripts/` × 3：`probe-harness-materializer-live.mjs:124`、`probe-deployment-secrets.mjs:71`、`bench-wanxing-bookkeeping.mjs:37` | 内联 | 探针/基准 |

前 9 处是必须对齐的活语义，含**前端一处**——身份规则已经漏进浏览器，改规则时详情页的对话链接会指向不存在的 slug。

余下 48 处在 4 棵影子树与 2 份生成物里：`paas-wecom-archive/`、`paas-ir-hotfix/`、`paas-ir-cards/`、`.work-paas-71/`（**隐藏目录**，各含一套 `gateway/wanxing/` + `facet/` + `agent-runner/` + `web/` 的整仓拷贝），以及 `paas/dist-opensource/{platform,publish}/`（开源导出快照，会随发布流出去）。

全量 `60` 处。本 change 只收敛两个真仓里的 9 处；影子树与生成物的处置见 `retire-wanxing-twin-face` 的清点任务。

`fleet-observability` 已经写明「single mapping rule shared by every consumer」，但它只覆盖观测面内部；事实上门面内还有两份（一份内联）、仓外还有四份、浏览器里还有一份。这份函数决定「这个 agent 对外叫什么」，任何一份漂移都会让同一台部署在不同面上变成两个身份——**而且不会有任何测试变红**。

**② 暂停/恢复的写逻辑也有两份。** 门面 `services/wanxing-facade/console.js:36 setPaused` 的注释自认是「Mirror of paas `lib/agent-serving.js` `setAgentPaused`（minimal copy, keep in lockstep until ②-收敛）」，而 `paas/lib/agent-serving.js:434` 确实有等价实现。两处都写 registry 的 `metadata.paused`（真相唯一，这点没问题），但**写它的规则**——尤其「`paused=false` 时删键而不是置 false」——各自维护。读路径漂移会立刻报错，写路径漂移是两个门都能用、只是某天开始行为不同。

**③ 出向依赖的编址有 7 个上游、每处各写一套别名规则。** 同一上游在不同组件用不同变量族（registry：facade 用 `AGENT_SERVING_REGISTRY_URL||REGISTRY_URL`，observer 用 `FLEET_REGISTRY_URL`）；同一组件内同一上游还有两套规则——记忆缝 `services/wanxing-facade/memory.js:30` 认 `CELL_MEMORY_URL||FD_MEMORY_URL`，而 `services/wanxing-facade/routes.js:203` 只认 `FD_MEMORY_URL`，于是配了 `CELL_MEMORY_*` 的部署里，对话回合能读记忆、控制台的记忆可见页却 503。同一台观测面，facade 认 `FLEET_OBSERVER_URL`，本机收集器认 `OBSERVER_URL`。

70 个 env 变量、没有一张表；`wanxing-borrowed-contracts` 要求「一处可发现」，但可发现的东西本身是散落的。

## What Changes

**① 身份单源（仓内一份）+ 跨仓夹具（仓外对齐）**
- 抽出 `services/wanxing-facade/identity.js`，导出唯一的 `slugFor`；门面的三份副本（`core.js`、`selfservice.js`）与观测面的一份（`bookkeeper.js`）全部改为 import 它。
- 跨仓不做代码共享（借用契约禁进程内耦合）：发布 `contracts/agent-identity.fixture.json` —— 一组「输入路径 → 期望 slug」的样本，含边界（前导斜杠、大小写、连续分隔符产生的 `--`、非 ASCII 归并、空串、已 slug 化）。paas 侧的实现（runner、脊柱、以及若保留的旧替身）各自跑同一份夹具；夹具是契约，代码各写各的。

**② 生命周期写逻辑收敛为一条规则**
- 暂停/恢复的真相是 registry 的 `metadata.paused`（唯一），但写它的规则有两份，且门面那份的注释自认「keep in lockstep until ②-收敛」——一直没收敛。
- 收敛目标：把「读到 entry → 改 `metadata.paused` → 没暂停时**删键**而不是置 false → upsert（register 兜底）」抽成一条有测试锁定的规则，两侧行为由同一组断言校验。跨仓不做共享代码（同 ①），做法是发布一份 `contracts/lifecycle-write.fixture.json`：给定 entry 与目标状态，期望的 upsert 载荷；两个实现各自跑它。

**③ 编址单一表**
- 抽出 `services/wanxing-facade/env.js`：一张声明表（`upstream × component → { canonical, aliases[], default, required }`），所有出向读取走同一解析器。
- 修掉实际会伤人的那处不一致：门面内两条路径对记忆上游接受不同的别名集合，统一后配 `CELL_MEMORY_*` 的部署两个面都能用。
- 声音要小：解析器对未知变量名不做猜测，未配置即 `null`（保持既有的「未配置 = 显式 503 / 功能隐藏」，不改成默认值）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fleet-observability`：扩写「Registry paths and rollup identities are mapped by one rule」——从「观测面内一个规则」扩到「本仓内一个函数、且其行为由一份对外发布的夹具锁定」，并规定夹具与本仓实现不一致时测试必须红。
- `wanxing-facade`：新增「出向依赖经一张声明表解析」——所有对兄弟线的编址读取来自同一张表、同一解析器，同一上游在同一组件内接受完全相同的别名集合与优先级；新增上游必须进表，不得就地 `process.env.X`。新增「生命周期状态只有一条写规则」——暂停/恢复的写载荷由一份对外发布的夹具锁定，两个门对同一 agent 产生相同的 registry 结果（`paused=false` 删键而非置 false）。

## Non-goals

- **不做跨仓共享代码或共享包**：契约以文件为界。把 `slugFor` 提成一个 npm 包会让三个仓的发布互相绑定，且违反 `wanxing-borrowed-contracts` 的禁令。
- **不改任何变量名、不改解析优先级**：既有部署的 env 一个都不动；这是「收敛实现」不是「改契约」。`wanxing-borrowed-contracts` 的优先级约束原样成立。
- 不给未配置项编默认值（保持显式降级）。
- 不处理 paas 侧旧替身的删除——那是 `retire-wanxing-twin-face` 的范围；本 change 只要求「若它还在，它也得过同一份夹具」。
- 不重构调用点的业务逻辑，只换寻址方式。

## Impact

**代码（fd-wanxing）**
- 新增 `services/wanxing-facade/identity.js`、`services/wanxing-facade/env.js`、`contracts/agent-identity.fixture.json`。
- 改：`services/wanxing-facade/{core,selfservice,routes,memory,chat,console,a2a,index}.js` 与 `services/fleet-observer/bookkeeper.js`、`services/stats-collector/collector.mjs`（改用共享解析器）。
- 测试：`scripts/test-wanxing-facade.mjs` 增身份夹具用例与别名等价用例；`scripts/test-fleet-observer.mjs` 增同规则用例。

**跨仓（由 paas 仓 `retire-wanxing-twin-face` 承接）**
- `paas/agent-runner/fleet.js`、`paas/facet/supply-catalog.js` 各加一条跑同一夹具的测试。

**部署**
- 零 manifest 变更。风险点：若线上某个部署其实只配了 `FLEET_OBSERVER_URL` 而未配 facade 认的名字（或反之），统一别名集合会**扩大**可识别集合（只会让原本 503 的面变可用），不会让任何现有配置失效。
