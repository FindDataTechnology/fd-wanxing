# 跨线副驾 · 交互面现状

> 2026-11-10 收口。变更本体已归档（`openspec/changes/archive/2026-11-10-unify-cross-line-copilot`），
> 技能供给的纪律见 [ADR-0006](../adr/0006-copilot-skills-source-of-truth.md)。
> 本文件只记「现在长什么样、怎么接、哪里会坏」，不重复 spec。

## 一句话

产品线页面挂一个 `<script>` 标签就有副驾；**用哪个 agent 由控制台的绑定决定，不写在宿主代码里**。

## 三段链路

```
① 接入        ② 解析                        ③ 回合
<script data-line="lex">  →  GET /api/wanxing/v1/lines/lex/copilot  →  匿名铸造 → chat SSE
（loader 注入 iframe）      （读绑定表，四态）                        （来源门 → 准入 → 结算）
```

- **接入**：宿主引 `https://<萬星域>/copilot.js`（源文件 `wanxing-web/public/copilot.js`——**URL 里没有 `/public/`**：
  Vite 把 `public/*` 拷到 dist 根，`/public/copilot.js` 会被 SPA 回退吞成 200 的 HTML，`<script>` 收到它即静默死；
  2026-11-13 起该路径改为 404）。loader 自己完成绑定解析、iframe 注入、`wx-copilot-*` 全协议；
  宿主只声明三个可选钩子（`identify` / `context` / `intents`），一个都不给也能跑。
- **解析**：绑定存在 facade 自己的库（`wanxing_line_copilots`），**不写兄弟线的部署台账**。
  四种态：`ready` / `unbound` / `unknown` / `closed(reason)`；只有 `ready` 才注入，其余零注入 + 一条 console warn。
- **回合**：匿名走来源门（每 agent 的 origins ∪ 平台 fallback），结算按渠道分列。

## 一条线接入的完整动作（含容易漏的）

| 步骤 | 谁做 | 漏了会怎样 |
|---|---|---|
| 1. 部署一个公开、可对话的 agent | 部署者 | 解析态就是 `closed`，loader 不出现 |
| 2. 控制台「线副驾」绑定 `line → slug` | ops | 页面挂着标签但永远没有副驾 |
| 3. 该 agent 的嵌入来源加上**这条线的域** | 部署者/ops | 副驾出现但一开口就「当前页面未被允许嵌入该助手」 |
| 4. （若想匿名可用）开平台匿名总开关 + 该 agent 的匿名开关 | ops / 部署者 | 访客看到登录升级；两闸不一致时控制台标「缺口 · 匿名未开」 |
| 5. agent 引用的技能必须在 registry 可解析 | 见 ADR-0006 | **冷启动 404，回合 `error` 且 `minutes=0`**（最隐蔽的一种） |

第 3 步和第 5 步是最容易漏的，因为它们都不在"接入"动作里，却都表现为"副驾不对"。

## 排查口诀（按现象分诊）

| 现象 | 先看哪里 | 说明 |
|---|---|---|
| 页面右下角什么都没有 | console 的 `[wanxing-copilot]` warn | `unbound`/`closed`/`resolution failed` 三种，直接指到病因 |
| 副驾出现但提示「未被允许嵌入」 | 该 agent 的 embed-settings `origins` | 来源门在**铸造**上，不在渲染上；`embed-config` 报 `anonymous:true` 不代表能铸造 |
| 开口就「本回合以错误告终」 | 回合台账 `outcome` + `minutes` | `error` 且 `minutes=0` = 上游/冷启动（见 [[ADR-0006]]），与身份/计费/loader 无关 |
| 只显示「登录后继续」 | 两处匿名开关 | 平台 `WANXING_CHAT_ANON_ENABLED` + 每 agent 开关，都要开 |

## 已知的边界与未办

- **平台级来源 fallback 为空**（`WANXING_EMBED_ORIGINS`）。当前每条线都得逐 agent 开来源；
  想让多个线站点共用同一副驾，需要先定"哪些域默认允许匿名"——这是产品决定，不是技术配置。
- **一条线一个对外副驾**。绑定表主键是 line，多副驾（按版面区分）留了 `surface` 列的扩展位但没做。
- **站内/对外副驾的助手来源有意分叉**：站内（壹座 CopilotDock）按形状解析已装 pack，对外按显式绑定。
  两边回答的是不同问题，不要"顺手统一"（design D4）。
- **入口不在站内页面**：识律控制台的副驾挂在 `ConsoleLayout`，需要登录才渲染；公开营销页不挂。

## 相关

- 变更与规格：`openspec/specs/wanxing-facade`（绑定+公开解析）、`openspec/specs/wanxing-web`（loader/面板/共用聊天核）
- 技能供给纪律：[ADR-0006](../adr/0006-copilot-skills-source-of-truth.md)
- 宿主示例页：`https://wanxing.finddatatech.cloud/host-demo.html?line=<线id>`（注意：该页域名需在目标 agent 的来源白名单里才可自测）
