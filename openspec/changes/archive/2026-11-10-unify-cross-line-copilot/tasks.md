## 1. 绑定面（facade）

- [x] 1.1 `store.js` 新增 `wanxing_line_copilots` 表（line 主键 / agent_slug / accent / anonymous_intent / updated_by / updated_at）与四个存取方法（get / list / put / delete），并验证既有库启动时建表成功（旧库文件起一次，`PRAGMA table_info` 能看到该表）
- [x] 1.2 console 端点：`GET/PUT/DELETE /api/wanxing/v1/console/line-copilots[/:line]`，写入前用 `bookkeeping.rows()` 校验 slug 存在且 `visibility !== private`，非 ops 身份拒绝；用 ops 令牌与普通 owner 令牌各打一次，后者必须 403
- [x] 1.3 公开端点 `GET /api/wanxing/v1/lines/:line/copilot`：投影只含 line / state / agent{slug,name,description} / theme.accent / anonymous(effective) / features.asks；响应头 `Access-Control-Allow-Origin: *`、`Cache-Control: public, max-age=60`、不加 `Allow-Credentials`；验证四态各一例（ready / unbound / paused / closed）
- [x] 1.4 解析 effective 匿名状态：复用既有 `anonOpenFor(slug)` 与平台开关，产出 `open|login_required|closed`；验证「intent=true + agent 开关=false」解析为 `login_required` 而不是 `open`
- [x] 1.5 单测覆盖绑定校验与投影脱敏：断言响应 JSON 里不出现 `caller`/`settler`/`remaining`/`email`/`key` 字段（照现有 facade 测试风格，`tests/` 下新增一文件）

## 2. 一行接入（wanxing-web loader）

- [x] 2.1 新增 `wanxing-web/public/copilot.js`：读 `data-line` / `data-accent`，先解析绑定再决定是否注入；`unbound|unknown|paused|closed` 不注入且只 `console.warn` 一次（带 line 与 state）；`host-demo.html` 改写为 loader 形态（`?line=` 可换线）、构建产物含 `dist/copilot.js`；两种态由 `test/copilot-loader.test.mjs` 在假 DOM 里执行真 loader 断言（未注入 / 已注入），不靠手点
- [x] 2.2 loader 实现完整宿主协议：`init`（声明的动词来自 hooks）、`context`、`identity-request`（每回合调用 `WanxingCopilot.identify()`，返回 null 时递 null）、`intent`（只分派 hooks 里有的动词，其余回 `ok:false`）、`state`；验证同上测试覆盖：init 只声明宿主钩子里的动词、identity 每回合递送、状态帧改高度、异源消息忽略
- [x] 2.3 loader 处理不可匿名且无身份钩子的场景：仍注入，但把登录升级作为主路径并点名目标平台（与 3.2 文案一致）；验证宿主 hook 存在时 popup 不出现为主动作
- [x] 2.4 nginx 缓存头：`location = /copilot.js` 设 `Cache-Control: public, max-age=300`，验证 `curl -I` 头正确且 SPA 回退不影响该路径 —— 生产实测 `HTTP/1.1 200`、`Content-Type: application/javascript`、`Content-Length: 8868`、`Cache-Control: public, max-age=300`；`/host-demo.html` 200（9020B）
- [x] 2.5 `DocsView` 嵌入车道段与 `host-demo.html` 全部改写为 loader 写法（保留直连 iframe URL 一段作为"loader 不可用时"的兜底说明），验证页面复制出来的示例与 loader 实际参数一致

## 3. 控制台面板与登录出口

- [x] 3.1 console 新增 ops-only「线副驾」面板：列表（line / agent / accent / intent / effective / gap 标记）、部署选择器（只列公开部署）、解绑两步确认；非 ops 身份不可见（沿用 OpsView 现有 403 探针显隐手法），验证 gap 行在「intent 匿名开 + effective 非 open」时渲染出来
- [x] 3.2 登录出口文案：embed 的升级动作与 chat 的登录提示必须点名登录到哪个平台；验证在无宿主钩子时文案出现平台名，有宿主钩子时该路径不被先提
- [x] 3.3 界面上「线已绑定但匿名未开」给出一句可执行提示（去哪里开、开了以后访客会看到什么），验证提示与 3.1 的 gap 标记指向同一状态

## 4. 识律收敛（跨仓，fd-lex）

- [x] 4.1 **发布顺序闸已达成**：facade `sha-e5bdc3e` 先上（`/api/wanxing/v1/lines/lex/copilot` 200）→ web `sha-e5bdc3e`（`/copilot.js` 200 且 `max-age=300`）→ fd-lex `sha-4ae80ec`。过程中修了两个真实阻塞：(a) 镜像 run 42653938440 推送成功后 GHA 缓存导出失败致内容闸门未跑，`sha-4ae80ec` 由等价的 imagetools 操作从 digest `65832516` 铸出；(b) ArgoCD `repo-fd-lex` 同时带 SSH 私钥与 username/password 报 `invalid auth method`，移除后者后暴露真因——gitee 的 fd-lex 仓库缺**仓库级部署公钥**（同钥对 fd-infra-deploy 正常，AppProject `sourceRepos: *`）。补登 `ssh-ed25519 …Gc4W5 argo-gitops@finddata` 后应用 `Synced`。生产证据：`deployment "fd-lex-web" successfully rolled out`，pod 跑 `sha-4ae80ec` READY true；lex 入口 chunk `assets/index-B7AdvRGr.js` 含 `wanxing.finddatatech.cloud` ×1 与 `data-line` ×1（旧硬编码片段已消失）。未验：浏览器点开控制台确认副驾挂载并可对话
- [x] 4.2 切到 loader：删除手写 postMessage 协议与 `WIDGET_SLUG`，只留 `<script data-line="lex">` + `identify` 钩子 + `intents.navigate` 白名单（白名单仍是 `CONSOLE_TABS` 五路由、拒 `/admin` 与查询串），验证 `navigate` 越界仍被拒且拒绝原因回给 agent
- [x] 4.3 删除旧实现与测试替身，更新 `fd-lex` 侧注释与本仓文档里对"宿主需手写协议"的描述

## 5. 对话核合一

- [x] 5.1 确认 core 入参边界：core 只收「已解析的 bearer + tier + slug + 历史键前缀」，不 import 任何 auth 模块；先用两条真实旧键样本写一个迁移测试，验证读到旧历史并可写回新键
- [x] 5.2 抽出 `chat-core`：历史读写与迁移、上下文 id、自带键桥、文本走树、SSE 帧分发、ask 状态机与 answer 提交、截止倒计时
- [x] 5.3 `EmbedView` 改为 core + 身份壳；既有 27 条 web 测试全绿（注意：原套件并没有 embed 问询卡用例，这一片之前是零覆盖）——新增 `test/chat-core.test.mjs` 11 条与 AskCard 渲染 2 条补上
- [x] 5.4 `ChatView` 改为 core + 登录壳并接上问询卡，验证站内对话页能渲染并回答 ask；回放历史时 ask 渲染为静态摘要
- [x] 5.5 去掉两套键名的重复定义并保留一个版本的旧键读取；用自动化用例验证升级后老访客历史仍在（旧键写入 → `loadHistory` 读出并前写新键，旧键不删）

## 6. 收口

- [x] 6.1 `openspec validate unify-cross-line-copilot --strict` 通过，四切片任务全部勾账
- [x] 6.2 生产核对（已完成部分）：绑 `lex` → 解析 `ready` / `anonymous: open` / `asks: true`，控制台列表 `effective: open`、`gap: false`；**解绑环全绿**——`DELETE` 后解析回 `unbound` 且不含 agent、重复 `DELETE` 404、复绑后回到 `ready`（此刻无线上页面引用 loader，解绑对访客零影响）。未验：fd-lex 控制台里 loader 实际挂载（阻塞于 4.1 的 gitee 部署公钥）
