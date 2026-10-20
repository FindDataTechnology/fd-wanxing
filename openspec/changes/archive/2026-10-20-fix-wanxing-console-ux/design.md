## Context

万星控制台消耗视图（`wanxing-web/src/views/console/StatsView.jsx`）有两张表格——「按 agent（fleet/local 口径）」5 列与「按模型」4 列，二者并排放在 `grid md:grid-cols-2` 的两个卡片里。表格用 `w-full`，靠 `truncate` 把长文本压进列内。

实测（真实浏览器，1280 / 1024 / 768 三档视口，注入真实形态的长 agent 名与 pack 名）：

```
by-agent 表（5 列）  1280: card 内宽 490，表宽 489，右边界 646 > card 右边界 634  → 溢出 12px
                     768:  溢出约 140px
by-model 表（4 列）  1280/1024: 不溢出
                     768:  溢出约 40px
「每日序列」块        966 容器内不溢出（非本次问题面）
```

根因在 `StatsView.jsx:145` 与 `:168` 两处的「口径」列：

```jsx
<td className="py-1 pr-2 truncate max-w-[14rem]">{r.agent}</td>          {/* 有 truncate */}
<td className="pr-2 text-slate-500 truncate max-w-[8rem]">{r.pack}</td>  {/* 有 truncate */}
<td className="pr-2 text-xs">{r.source}/{r.basis}</td>                    {/* 没有 */}
```

`truncate` 是 `overflow:hidden + text-overflow:ellipsis + white-space:nowrap`。两个邻居有它，长名被压在列内；「口径」列没有，浏览器按内容撑列宽，把整张表推出卡片。表头与表身是不同的 DOM 节点，列宽被内容顶开后二者算出的列位置不一致——这就是用户看到的「文字错位」。

动机见 proposal.md - Why。

## Goals / Non-Goals

**Goals**
- 让两张表格在任何内容长度与视口宽度下都容纳在自己的卡片内。
- 让列宽只由布局决定，不由内容决定；表头与表身始终对齐。
- 保持三口径（fleet 估算 / sub2api 计费 / local 估算）分列的语义与视觉区分不变。

### 黑屏：带 token 进 `#/console` 必然崩溃

用户确认黑屏落在万星自己的 `#/console`（截图 URL 即 `https://wanxing.finddatatech.cloud/#/console`），不是 Logto 登录页。实测：

```
未登录 #/console（深/浅色）：渲染正常，登录卡在卡片内 top=153 h=116，无 pageerror
                            → 深色下大部分是深底，但内容在，不是"黑屏"
带 token #/console（深色）：root 子元素 = 0，root innerHTML = 0，页面全空
                            pageerror: TypeError: Cannot read properties of undefined (reading 'planMinutes')
```

即**黑屏发生在登录成功、带 token 回跳到 `#/console` 之后**。跳转链路本身实测正常（303 → Logto sign-in → 登录页渲染「登录你的账号」，无异常），所以问题不在登录，在控制台的渲染。

崩溃点是 `FleetView.jsx` 对后端响应深层字段的无保护读取：

```jsx
// :513 — stmt.usage 为 undefined 即抛 TypeError
套餐结算 <b>{stmt.usage.planMinutes}</b> 分钟（{stmt.usage.planTurns} 回合） · ...
// :538 — earn.totals 为 undefined 即抛 TypeError
已入账 <b>${(earn.totals.settledUsd ?? 0).toFixed(4)}</b>
```

注意 `:538` 已经写了 `earn.totals.settledUsd ?? 0` —— `??` 只兜住叶子，兜不住 `earn.totals` 本身为 undefined。React 中任一组件渲染抛错会**卸载整棵树**（无错误边界时），root 变空 → 深色底 = 用户看到的黑屏，且控制台层面无任何提示。

我用后端真实响应形状逐个试过，崩溃是**顺序暴露**的，与数据形状无关：

| 注入的 statement 形状 | 结果 |
|---|---|
| 无套餐（含 usage） | 崩 `settledUsd`（下一处） |
| 有套餐（含 usage） | 崩 `settledUsd` |
| 缺 usage（旧形状） | 崩 `planMinutes` |

即修掉一处只是让崩溃挪到下一处。真正要治的是"任一面板渲染异常不该掀翻整页"。

### 决策 4：错误边界 + 可选链双管，而不是只补可选链

**选择**：(a) 深层读取改可选链 + 默认值，(b) 控制台加一层 React 错误边界。

**理由**：只做 (a) 能修掉已知的两处，但 `FleetView` 还有 `:438 usage.doc.byCaller`、`:473`、`:522 myPacks.packs`、`:545 earn.rows` 等多处同型读取（`grep` 出的未保护深层读取约 15 处），逐个补完既慢又必然遗漏下一处。只做 (b) 则把已知的具体缺陷留给兜底，用户看到的是"出错"而不是正确数据。两者都要：(a) 治已知，(b) 治未知。

**备选**：只补可选链。快，但等于用穷举对抗一类问题，本仓已有教训（记忆「模块级验收≠端到端验收」）表明这类"看起来修好了"最易复发。

### 决策 5：错误边界放在控制台层，不放在每个面板

**选择**：在 `ConsoleView` 内包一层错误边界，粒度到控制台整体（或按页签）。

**理由**：黑屏的全部危害是"整页归零"，控制台级边界已能保住页头、页签与其余面板。逐面板加边界会显著增加代码量，而收益（单个面板挂掉时其余更细粒度存活）对当前规模不划算。

## Decisions

### 决策 1：给「口径」列补 `truncate` + 最大宽度，而不是给它加 `table-fixed`

**选择**：在 `:145` 与 `:168` 两处补 `truncate` 与一个 `max-w-*`，与相邻列写法保持一致。

**理由**：改动面最小（两处 class），且与文件内既有约定完全一致——「口径」列是漏网的那个，不是设计意图不同。它让列宽交回给表格布局算法，与 `agent`/`pack` 列的既有行为对齐。

**备选**：给 `<table>` 加 `table-fixed` 并为每列显式指定宽度。这能更彻底地固定列宽，但要为 5 列都挑宽度值，且 `table-fixed` 会让所有列等分或按声明值分配，需要重新调一遍 `agent`/`pack` 两个已调优的 `max-w-*`，风险与改动量都更大。留作后续若仍不稳的备选。

### 决策 2：两张表格外包 `overflow-x-auto` 作为窄屏兜底

**选择**：两张 `<table>` 各包一层 `overflow-x-auto`。

**理由**：决策 1 解决的是「内容撑宽」，但 768px 及以下时卡片本身变窄（实测 362px），即便所有列都截断，5 列表格的自然最小宽度仍可能超过卡片。横向滚动是窄屏的正确兜底，且 `DocsView.jsx:51` 与 `IntroView.jsx:54` 已经是这个写法——跟着既有约定走，不引入新模式。

**备选**：窄屏下改成卡片列表（每 agent 一张卡）。可读性好但等于重写视图，超出本次修复范围。

### 决策 3：验收靠浏览器实测的几何量，不靠「看起来对」

**选择**：验收断言读取真实 DOM 几何——表格右边界 vs 卡片右边界、表头 th 与表身 td 的 x 坐标、单元格 `scrollWidth > clientWidth`（是否截断）。

**理由**：本仓已有教训（见母仓 `paas` 记忆「模块级验收≠端到端验收」「突变测试是唯一可信复现」）：这类渲染缺陷肉眼可糊弄过去，只有量化断言能证明修好了，也才能防止回归。本次的根因本身就是靠浏览器实测定位的，验收沿用同一手法。

**代价**：需要一个能注入长数据的实测环境。用本地 vite dev + 注入真实形态数据即可，不需要真实生产账号（表格渲染与身份无关）。

## Risks / Trade-offs

- **[截断后信息不可见]** → 「口径」列取值集合很小且固定（`fleet|local|sub2api` × `estimated|billed`），最长的 `sub2api/billed` 约 15 字符；挑一个容纳它的 `max-w-*`，正常取值不会触发截断。真被截断时保留 `title` 属性无损查看。
- **[只修了这两张表]** → 控制台还有 `FleetView.jsx:431` 的调用者表格（5 列，同样无 `truncate`、无滚动兜底），存在同类隐患。本次按用户报告范围不纳入；在 tasks 末尾记一条待查项，确认后另立 change。
- **[错误边界掩盖真实缺陷]** → 边界把崩溃变成"可见错误"，但若之后无人看这些错误，缺陷就被静默吞掉了。缓解：错误提示文案要求带上可诊断信息（哪个面板、原始错误消息），并在验收时断言"正常数据下不出现任何边界错误"（见 tasks 2.5）。
- **[可选链把"缺字段"变成"显示 0"]** → 可能把后端真缺陷伪装成"零数据"，与 `add-serving-plans` 里"读取失败必须显式报错、不能显示成没有"的既有纪律冲突。缓解：区分两态——HTTP 失败走 `stmtErr`/`earnErr` 显式报错（既有逻辑，保留）；HTTP 成功但字段缺失才走可选链占位。不在错误分支里静默填 0。
- **[窄屏体验仍紧]** → 横向滚动是兜底不是解法。768px 下 5 列表格滚动查看体验一般，但万星控制台以桌面使用为主，本次不做响应式重排。
- **[改 CSS 无单测覆盖]** → 现有测试是服务侧单测，覆盖不到渲染。靠上述浏览器实测补，不新增单测。

## Migration Plan

1. 改 `FleetView.jsx` 深层读取为可选链 + 占位，并在 `ConsoleView` 加错误边界。
2. 改 `StatsView.jsx` 两处 class + 两层包裹。
3. 本地 `vite dev` 起服务，浏览器实测：
   - 带 token 进 `#/console`，注入正常形状响应 → root 非空、无 pageerror、无边界错误；
   - 注入缺字段响应 → 页面仍非空、显示可见错误/占位；
   - 三档视口（1280 / 1024 / 768）量表格几何：表格右边界 ≤ 卡片右边界；每个 `th` 与同列 `td` 的 x 坐标一致；长单元格 `scrollWidth > clientWidth`。
4. 按既有 `Dockerfile.web` / 通用池流程出片 web 镜像并滚产。
5. 生产回归：真实登录进 `#/console`（确认不再是黑屏），再打开消耗视图确认两张表列头列身对齐、口径标注仍在。

**回滚**：纯前端渲染改动，无数据迁移、无 API 变更；回滚即重新出片上一版镜像。

## Open Questions

- `FleetView.jsx:431` 调用者表格是否同病（5 列、无 truncate、无滚动兜底）——已记为待查项，不在本次任务内。
- 真实生产数据下，`#/console` 崩的是哪一处（`planMinutes` 还是 `settledUsd`）——两者都要修，顺序不影响方案；出片后按生产回归第 5 步确认。
