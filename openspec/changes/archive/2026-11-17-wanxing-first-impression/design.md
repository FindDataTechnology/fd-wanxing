## Context

动机见 `proposal.md` — Why。这里只记实现约束。

现有可复用的地基（都已存在，本刀不新建）：

- `wanxing-web/src/status-facts.js` 已经是全站单一事实表（七种事实 + 一条优先级链 + `badgeFor`）。
  目录、详情、舰队卡、运维板都调它。**卡片去噪的抓手就是它**，不是新造一套徽标体系。
- `wanxing-web/src/chat-core.js` 已经是两个对话外壳（`ChatView` / `EmbedView`）共用的核心：
  历史持久化、上下文身份、自带键桥、A2A 帧文本抽取、SSE 分发、问询卡应答路由。
  **markdown 渲染器放这里，是因为规格要求两个外壳不能漂移，而这是唯一被两边都 import 的模块。**
- `/api/wanxing/v1/status` 已被页脚 `StatusStrip` 消费（`agents` / `turns7d` / `settlement_pending`），
  首屏读数是同一个端点的第二次消费，无新后端。
- 目录卡片已经有 `#/chat/<slug>?q=…` 预填契约（`add-catalog-discovery`），登录回流已有
  `loginLogto({ returnTo })`（`auth.js`，chat 车道已在用）。本刀是把两者接起来，不是发明。
- `@theme` 里已有印章红四档（`--color-accent` 等），`index.css` 只有 31 行——视觉权威缺文档，不缺代码。

约束：

- 无 markdown 依赖、不新增 npm 包（proposal Non-goals）。
- 不改任何后端端点契约；本刀是纯前端消费侧。
- `wanxing-web/test/` 是 node:test + esbuild 自建 JSX loader，**没有 jsdom**——渲染器必须能在纯
  Node 下测（返回字符串或结构，不依赖 DOM）。
- 视觉世界是 refinement 不是 redesign：印章红、slate 双色、中文优先、单站点记号全部保留。

## Goals / Non-Goals

**Goals:**

- 首屏第一眼是活体读数 + 真卡片；读数失败零布局破坏。
- 卡片信息元件收敛到四件，同质填充语彻底消失，主徽标唯一。
- assistant 文本按受控 markdown 渲染，两个外壳共用；raw HTML 不被解释。
- 登录从"死墙"变成"原地门槛 + 落回原对话"。
- 舰队卡首行给结论；管理动作分两级。
- 给万星补 `PRODUCT.md` / `DESIGN.md`，让后续每一刀有共同的视觉与产品权威。

**Non-Goals:**

- 不接匿名梯队到对话车道（域边界另议）。
- 不做目录策展闸（哪些 agent 该对外是运营规则）。
- 不重排控制台五个 tab 的信息架构。
- 不改嵌入车道的身份阶梯、宿主协议、`copilot.js`。
- 不动 `status-facts.js` 的事实表与优先级链——它是既有共识，本刀只保证消费侧不再稀释它。

## Decisions

### D1 · markdown 渲染器自持在 `chat-core.js`，输出字符串

**决定**：`renderMarkdown(text) → string`，纯函数，零依赖，放 `chat-core.js` 并导出。两个外壳用
`dangerouslySetInnerHTML` 消费（渲染器自己保证只产出受控标签）。

**为什么不是引入 `marked` / `markdown-it`**：
- 体积：`marked` ~50KB min，而我们的子集只有段落/列表/行内码/代码块/粗体/标题/链接/分隔线。
- 安全：外部库默认允许内联 HTML，要么再配 `DOMPurify`（又一个依赖），要么配一个容易漏的清洗规则。
  自持子集是**白名单式**的——只产出已知的七个标签，未识别的字符全部 `escapeHtml`。这比"黑名单清洗"
  正确得多，而且审计面是我们自己的 60 行。
- 测试面：纯字符串函数，node:test 直接断言，不需要 jsdom。

**替代方案与放弃原因**：
- 渲染成 React 元素树 → 需要递归 + key 管理，且 `EmbedView` 已经在用字符串气泡，改造成本更高；
  字符串注入更小、两侧同构。
- 只做 `**` 与换行 → 真机看到的问题是列表和代码块（agent 输出大量 `- **要点**`），不够。

**受控子集（唯一白名单）**：`<p>` `<ul><li>` `<ol><li>` `<pre><code>` `<code>` `<strong>`
`<h4>`（标题一律降为 h4，气泡里不需要 h1–h3 的语义层级）`<a href>` `<hr>`。
链接只接受 `http:`/`https:`/`mailto:`，一律加 `rel="noopener noreferrer" target="_blank"`。

### D2 · 首屏读数复用页脚那次取数，不引入第二个状态源

**决定**：把 `StatusStrip` 的取数逻辑提到一个 `usePublicStatus()` 钩子（或直接把当前 fetch 提取为
`fetchPublicStatus()`），页脚与首屏各自调用，**各自独立降级**。

**为什么不共享一个全局缓存**：站点无状态库；一次 12 行 fetch 的重复成本远低于引入 context/store 的
复杂度。两个消费者分别失败是正确语义——页脚读数可用而首屏降级（或反之）不该互相污染。
（ponytail：两次同 URL 请求，加缓存当且仅当实测首屏被它拖慢。）

**首屏卡片取数**：直接打 `/api/wanxing/v1/agents?page_size=6`。决策理由：目录页的 `page_size=12` 与
facets 不需要，首屏只要六张。失败 → 不渲染卡片区，输出一句 "agent 暂时列不出来"。

### D3 · 卡片"四件"用现有的字段，不向后端要新字段

| 元件 | 来源 | 现状问题 |
|---|---|---|
| 一句能干什么 | `description` | 已有，只是被填白话盖掉 |
| 一枚主事实徽标 | `badgeFor(factOf({status, health}))` | 已有，只是旁边还挤着 5 枚同声量徽章 |
| 一个分类信号 | `category`（可无） | 已有；`chatable` / `cluster.role` / `turns7d` 降为**文本级**，不再用彩色 chip |
| 一个入口 | `chatable && !paused` → 对话，否则 → 详情 | 现状对所有卡都渲染"对话"，且 `paused` 未参与判定 |

**为什么把 `turns7d` 从彩色 chip 降为文本**：一个数字 + 一个彩色底是一个假的视觉重点；
"近 7 天 33 回合"作为一行小字已经足够扫读。

**删除的兜底**：`examples` 为空时的"对话即试用——直接问它一个你手上的真实问题"这句在 19/19 卡上重复，
它零信息量。删掉；空 `skills` 时连 `<details>` 都不渲染（现状是渲染一个只含 slug 的折叠区）。

**slug 去哪**：详情页与"复制 slug"按钮保留；卡片上不再有 slug 折叠区。规格已按此改写。

### D4 · 登录回流用现有 `returnTo`，但必须验证带 query 的 hash 往返

**决定**：登录按钮 `loginLogto({ gate: "chat", returnTo: location.hash })`——传**完整 hash**（含 `?q=`）
而不是现在只传 `#/chat/<slug>`。

**风险点**：`auth.js` 的 PCKE 状态机把 `returnTo` 存进 sessionStorage 后做 `location.replace(origin + returnTo)`；
若 `returnTo` 含 `?` 与 `%` 编码字符，可能被二次编码或截断。**这条必须真机验一遍**（登录 → 回调 →
hash 与输入框）。若不可行，退回方案：登录前把草稿写进 `sessionStorage`（一个 key），回调后 chat view
读它填进 composer——语义相同，路径更稳。tasks 里两条都列，实测选一条。

### D5 · 舰队卡首行结论从既有三处信号合成，不新增取数

已有：`fact`（`fleetFactOf`）、`sig.turns7d`、`health.expected_turns`/`stalled`。

```
failing/degraded  → "持续失败 · {原因}" / "部分失败 · {原因}"
paused            → "已暂停，访客不可用"
unknown           → "状态未知（快照不可得）"
stalled           → "该跑没跑 · 按声明应有 {n} 次"
unused            → "尚无调用"
live              → "近 7 天 {turns7d} 回合，无健康告警"
```

这是**已知事实的句子化**，不是新的判定逻辑——任何一项与徽标冲突都说明事实表被绕过了，测试要拦。

**按钮分层**：卡上留「配置」「记录」两个主操作 + 一个「更多」展开；展开里的项保持原 `onClick` 与 testid。
抽屉、端点、面板内容一概不动。

### D6 · 视觉：`PRODUCT.md` + `DESIGN.md` 先落文档，再动皮肤

**决定**：先给 `fd-wanxing/` 写两份文档，把**现存**世界钉住（印章红 `#a6402f` 单强调、slate 双色、
中文优先、`SiteMark` 单字记号、明暗双模走 `prefers-color-scheme`），然后所有改动在这套世界内做 refinement。

**为什么不借工作区根的 `DESIGN.md`**：root 那份描述的是官网（夜色控制台 + Terminal Mint 单信号 +
1080px 容器 + 零阴影），与万星的 slate 浅色面 + 印章红是**两个世界**。混用会让后续每一刀都猜。

**气质方向**（写进 DESIGN.md，不改现有实现）：万星是**运行台账/仪表盘**的安静感——数据用等宽、
状态用单一徽标、颜色只服务状态与动作。首屏读数条是这套气质的第一次真正出场：数字大、字小、无彩色装饰。

**impeccable 执行口径**：改动期间以 `craft-floor` 为底线（对比度 ≥4.5:1、焦点态可见、
浏览器 surface——选区/caret/滚动条/表格数字——从调色板取色、状态齐全：hover/disabled/loading/error/empty），
改完跑一次 `impeccable detect --json`；不做开放式自评循环。

## Risks / Trade-offs

- **首屏多两次请求**（status + agents×6）→ 二者都允许失败且失败不破坏布局；若实测首屏变慢，
  把 `StatusStrip` 的取数提取为共享函数并加一个模块级 in-flight promise（不是缓存），已在 D2 记下升级路径。
- **`dangerouslySetInnerHTML` 是攻击面** → 白名单渲染器只产出七个标签，所有文本先 escape；
  单测覆盖 `<script>`、`javascript:` 链接、`onerror=` 属性、未闭合代码块四种注入尝试。
  若日后子集扩张，必须同步扩测试，否则不加标签。
- **MODIFIED 规格会整体替换既有 requirement** → 已用 `openspec validate --strict` 校验带全了旧 scenario
  （intro 的"first visit lands on the intro"/"intro stays static"、chat 的"The login gate precedes chat"
  已补回原文场景名）。归档时若再报缺失，说明改规格时又漏了。
- **首屏卡片与目录页可能给出不同印象**（首屏 6 张、目录分页 12 张）→ 同一份 API、同一套卡片组件，
  差异只在数量；若日后首屏需要"精选优先"，走目录已有的 `featured=1`，不新造排序。
- **删掉填充语后，19 张卡中有 0 张有示例问题** → 卡片高度会明显缩短，视觉上可能显得"空"。
  缓解：卡片靠 `description` 撑高度（现状 description 都真实存在且长短不一），并用
  `grid` 的等高让同排卡片对齐；不补任何填充物。
- **舰队卡首行结论依赖 health 段** → health 段不可用时结论只说 status 能说的（"尚无调用"/"在役"），
  不冒充健康；`fleetFactOf` 已有这条回落逻辑，直接复用。

## Migration Plan

纯前端静态站，无数据迁移、无后端变更。顺序：

1. `PRODUCT.md` / `DESIGN.md` 落盘（先有权威，后有改动）。
2. `chat-core.js` 加渲染器 + 单测（独立可测，不依赖其他改动）。
3. `ChatView` / `EmbedView` 接渲染器（小改，两侧各三行）。
4. 卡片（目录 + 首屏共用 `AgentCard`）+ 详情三段。
5. intro 首屏重排。
6. 登录回流（含 D4 的回退方案实测择一）。
7. 舰队卡首行结论 + 按钮分层。
8. `npm test` + `impeccable detect` + 本地 `vite build`；出片走常规静态镜像线。

**回滚**：整套改动在一个 change 内、无 schema/契约变更；回滚 = 回退镜像 tag，无数据后遗症。
markdown 渲染若出问题，`renderMarkdown` 退化为 identity（纯文本转义）即回到今天的行为——保一个开关式
回退点，不需要第二个 release 决策。
