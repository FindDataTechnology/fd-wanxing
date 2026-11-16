## 1. 权威文档先落（DESIGN.md 决策 D6）

- [x] 1.1 写 `fd-wanxing/PRODUCT.md`：平台 web、三类参与者（部署者/访客/供给方）、产品定位（万星=上线运行面）、
      能力与约束（借用契约、单强调色、中文优先）（verified: 文件存在且含 Platform/Users/Product Purpose/
      Capabilities/Constraints 五节）
- [x] 1.2 写 `fd-wanxing/DESIGN.md`：把**现存**世界钉住——slate 中性面三档、印章红 `#a6402f` 单强调及其
      暗色提亮档、单字站点记号、中文字优先栈、明暗双模走 `prefers-color-scheme`、圆角/间距刻度、
      徽标与状态词汇（引用 `status-facts.js` 七事实）（verified: 文件中的色值与
      `wanxing-web/src/index.css` 的 `@theme` 逐项一致，`npm test` 全绿不受影响）
- [x] 1.3 用 `impeccable` 的 `document` 口径复核两份文档是否覆盖真实实现（verified: 文档中每个
      颜色/字体/圆角值都能在 `src/index.css` 或组件内找到出处，无编造）

## 2. 受控 markdown 渲染器（design D1，规格「Assistant text is rendered through one controlled markdown formatter」）

- [x] 2.1 在 `wanxing-web/src/chat-core.js` 实现并导出 `renderMarkdown(text) → string`：白名单只有
      `<p> <ul>/<ol>/<li> <pre><code> <code> <strong> <h4> <a> <hr>`，所有文本先 escape（verified:
      新增 `test/markdown.test.mjs`，断言七类构造各自渲染成对应标签）
- [x] 2.2 注入面单测：`<script>alert(1)</script>`、`javascript:alert(1)` 链接、`onerror=` 属性、
      未闭合代码块、表格与 `<img>` —— 全部以转义纯文本出现，不外泄可执行标签/协议（verified: 同测试文件中
      五条断言全绿）
- [x] 2.3 链接处理：仅 `http`/`https`/`mailto` 成为 `<a>`，一律 `target="_blank"` +
      `rel="noopener noreferrer"`（verified: 单测断言安全链接带两属性、`javascript:` 不产出 `<a>`）
- [x] 2.4 `ChatView` 与 `EmbedView` 的 assistant 气泡改走渲染器；user 气泡保持 `whitespace-pre-wrap` 纯文本
      （verified: `test/views.test.jsx` 或新增用例断言 user 气泡内 `**x**` 原样呈现、assistant 气泡出现
      `<strong>`；两处 import 同一个 `renderMarkdown`，`grep -c "renderMarkdown" src` ≥ 2 且只来自
      `chat-core.js` 的定义一次）
- [x] 2.5 气泡内排版：代码块等宽、`overflow-x-auto`、列表缩进、`h4` 尺度小于正文标题（verified:
      `src/index.css` 增添的 markdown 作用域类在深浅两模下对比度 ≥4.5:1，`impeccable detect` 不报对比度）

## 3. 卡片去噪（规格「The public catalog page lists agents for humans」、design D3）

- [x] 3.1 `AgentCard` 收敛为四元件：描述一行 / 一枚 `badgeFor(factOf(...))` 主徽标 / 至多一个分类信号 /
      一个入口（`chatable && !paused` → 对话，否则 → 详情）（verified: 新增用例断言每个 `agent-card-*`
      内主徽标计数为 1，且无 `paused` 的卡不再出现对话 CTA）
- [x] 3.2 删除同质填充语：`examples` 为空时不再输出「对话即试用…」；`skills` 为空时连 `<details>` 不渲染
      （verified: 用 19/19 真实形状（examples=[] skills=[]）的 fixture 渲染，断言页面文本中不出现该句，
      且 `details` 计数为 0）
- [x] 3.3 `turns7d` / `chatable` / `cluster.role` 从彩色 chip 降为次级文本（verified: 用例断言这些信息
      仍可见，但不再带彩色背景类；主徽标仍是唯一彩色状态标记）
- [x] 3.4 入口携带示例问题（`#/chat/<slug>?q=…`）在详情与卡片两处都成立（verified: 用例断言生成的 href
      含编码后的 `?q=`）

## 4. 详情三段（规格「Catalog cards open a detail view」）

- [x] 4.1 详情页重排为三段：是什么 / 现在怎样（主事实徽标 + `turns7d` + `status_as_of` 快照时间）/ 怎么接
      （对话入口 + 带该 agent 路由的 A2A curl + 嵌入一行脚本）（verified: 真机打开任一 agent 详情，
      三段标题可读、curl 与 slug 一致、复制按钮可用）
- [x] 4.2 可见性用文字说明：`paused` → 「已暂停」、私有 → 「未对访客开放」、需登录 → 「需登录」（verified:
      用例断言三种情形各自出现对应中文句子，且不依赖禁用按钮表达）
- [x] 4.3 无 `examples` 时不编造示例，仅留对话入口（verified: 用空 examples 的 fixture 断言无示例区域）

## 5. 首屏重排（规格「The public intro view is the default landing」、design D2）

- [x] 5.1 提取 `fetchPublicStatus()`（或 `usePublicStatus`），页脚 `StatusStrip` 与首屏读数条各自消费、
      各自降级；不引入共享 store（verified: 两处独立 catch，断网模拟下页脚仍输出静态行、首屏不出现
      skeleton/错误横幅）
- [x] 5.2 首屏结构：活读数（在役数 · 近 7 天回合）→ 最多 6 张真卡片（复用 `AgentCard`，
      打 `/api/wanxing/v1/agents?page_size=6`）→ 定位一句 → A2A 示例（同一 `A2aSample`）→ 目录/文档 CTA
      （verified: 真机首屏截图，第一视口内可见读数与至少 3 张卡）
- [x] 5.3 删除首屏三块自述功能卡与计费口径表；计费与关于下沉到下方（`#/docs` 保留同口径）（verified:
      首屏文本中不再出现「服务目录/A2A 调用/计量与计费」三卡，计费口径仍可从页面可达）
- [x] 5.4 目录读失败时首屏仍完整：一句「agent 暂时列不出来」+ 其余静态内容（verified: 用例或断网模拟
      断言首屏不空白、不出现「没有 agent」措辞）

## 6. 登录回流（规格「The chat view…」、design D4）

- [x] 6.1 未登录的 chat 页：登录条原地渲染，agent 名称/描述/URL 草稿同时可见（verified: 真机未登录打开
      `#/chat/<slug>?q=…`，三者同屏）
- [ ] 6.2 登录按钮传完整 hash 作 `returnTo`（含 query）；真机走一遍 Logto 回调（verified: **部分**——代码路径
      已改（`returnTo: window.location.hash`）且有源码契约测试；浏览器实测含中文 + `&` + 空格的 `?q=` 在
      `location.hash → 完整 URL → 新 hash` 三段往返后**字节一致**（`%E4%BD%A0...` 不变，解析回原文正确）。
      **未验**：真实 Logto code 交换后的落地（需登录态账号，本会话未做）——留在 8.4）
- [x] 6.3 若 6.2 因编码/截断不可行，改用 sessionStorage 草稿桥 —— **条件不成立，故意跳过**：URL 往返已实测
      无损，不需要第二条路径。（verified: 见 6.2 的往返实测；不引入第二套草稿机制以免两条路各自漂移）
- [x] 6.4 登录墙文案改为说明"登录后可落回这个对话"，不再是一句无来由的账户请求（verified: 页面文案包含
      agent 名与"登录后接着问"语义）

## 7. 舰队卡结论（规格「The fleet tab renders deployment cards」、design D5）

- [x] 7.1 每张舰队卡首行输出结论句（failing/degraded/paused/unknown/stalled/unused/live 七分支，
      全部由既有 `fact` + `sig.turns7d` + `health` 合成，不新增取数）（verified: 新增 `fleetConclusion`
      单测覆盖七分支；真机舰队截图每卡首行是句子不是数字）
- [x] 7.2 管理动作分两级：卡上「配置」「记录」+ 一个「更多」展开；其余项移入展开区，`onClick`、抽屉、
      端点、testid 全部不变（verified: 逐一打开六个面板 + 暂停/恢复，行为与改前一致；
      `grep` 确认既有 `data-testid` 未改）
- [x] 7.3 结论与主徽标不得冲突（verified: 单测用「health=failing + status=serving」组合断言结论说失败、
      徽标也说失败，二者同为非健康）

## 8. 验收与出片

- [x] 8.1 `cd wanxing-web && npm test` 全绿（含新增 markdown / 卡片 / 首屏 / 舰队结论用例；
      既有断言只增不删）（verified: 123 tests / 123 pass / 0 fail——基线 92 → 现在 123，新增 31 条；
      改写而非删除的 3 条是规格变更导致的断言改写，见下注）
- [x] 8.2 `npm run build` 通过，无新增依赖（verified: `git diff --stat wanxing-web/package.json` 输出为空；
      `vite build` 成功，产物 `index-*.js` 299 kB）
- [x] 8.3 跑一次 `impeccable detect --json` 覆盖改动文件（verified: 返回 `[]`——8 个改动文件零硬伤）
- [ ] 8.4 真机四点验收：首屏读数+卡片、目录卡去噪、登录回流落回原对话、assistant markdown 渲染
      （verified: **三点已验 + 一点部分**。①首屏：真机读到「19 个 agent 已上线 · 53 近 7 天回合 · 0 结算中」
      + 6 张真卡（`fi-landing.png`）；②目录：19 张卡各带自己的描述、一枚主徽标、无填充语、无空折叠区、
      入口为描边红（`fi-catalog.png`）；③markdown：注入 formatter 真实输出，暗/亮两模下方框、列表、
      代码块、链接、有序列表全部成型（`fi-assistant-markdown.png`）；④登录回流：草稿随 URL 带过并显示
      在登录条上（`fi-chat-login-gate.png`），**但未做真实 Logto 回调落地**——需登录态的账号，留给下一次
      带凭据的验收）
- [x] 8.5 断网/接口失败演练：status 失败 + agents 失败（verified: `/api/*` 全 503 时首屏输出「agent 暂时
      列不出来——服务本身仍在运行」、零骨架、定位与示例照常（`fi-degraded-landing.png`）；目录输出
      「目录暂不可用（catalog HTTP 503）——这不是「没有 agent」」。登录回调异常一项未演练：与 8.4④ 同一
      前置条件（真实账号），合并到下次带凭据验收）

> **改写的 3 条既有测试**（规格变更所致，不是删断言）：`2.2 已知内部标签译成中文` → 改为断言分类信号
> 翻译（标签墙已按规格移出卡片，fail-open 仍由 `labels.test.mjs` 覆盖）；`2.3 skills 未声明时不出空列表`
> → 扩为「四元件 / 无填充语 / 无空折叠区 / 入口按事实」；`fleet-more` 相关的分层说明保持不变。
> **另有一条真机发现**：embed 车道按设计拒绝未登记的来源（localhost 不在允许清单），所以本地 harness
> 无法跑通一个真实 turn——这证明的是来源白名单在工作（`fi-embed-origin-refused.png`），不是缺陷。
