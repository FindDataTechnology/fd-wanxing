# Tasks — harden-copilot-ask-and-intent

## 1. 先确认链路（避免重复改对的东西）

- [x] 1.1 链路确认（verified: 上游恢复后真机——SSE 实测 agent 产出 `event: ask` + `intent:navigate:/console/usage` 信封；widget 渲染出 `data-testid="wx-embed-ask"` 卡片含「执行/跳过」；curl 直调 ask-answer 返回 `accepted:true`。**发现 agent 本来就会发 intent 信封**，proposal 里「agent 不知道何时该发」的判断对 intent 类不成立——但一般性离散选择实测不出卡（问「给我几个选项」得 0 张），规则段仍有必要）
- [x] 1.2 宿主意图端到端（verified: 识律控制台真机点「执行」后 `lex.finddatatech.cloud/console` → `/console/usage` 真实跳转；结果回传 UI 显示「问询已答：带你打开用量页查看本月统计？ → 执行」。**但暴露一个缺陷**：浏览器里答案送不回去（见 3.2），已修 `authFetch` 覆盖宿主票的问题）

## 2. 问询卡规则（pack prompt 侧，主工作量）

- [x] 2.1 把 D2 的三条判据 + 反面清单写成一份可复用的规则段（verified: 规则文本成型，四条线可引用同一份）
- [ ] 2.2 识律副驾 agent 接入该规则段（verified: 真机问一个离散选择问题，`[data-testid^="wx-ask"]` 计数 > 0）
- [ ] 2.3 柏讯专家 agent 接入（verified: 同上）
- [ ] 2.4 谦面专家 agent 接入（verified: 同上）
- [ ] 2.5 寻数分身 agent 接入（verified: 同上）
- [x] 2.6 反面验证（verified: 真机问「介绍一下这个控制台能干什么」这种开放问题，`[data-testid="wx-embed-ask"]` 计数 = 0，agent 直接文字作答）

## 3. 宿主意图规则（pack prompt 侧）

- [x] 3.1 把 D3 的两条铁律（动词白名单由宿主动态声明；提议走 envelope 不退化成自然语言）写进规则段（verified: 规则文本成型）
- [x] 3.2 识律副驾宿主意图端到端（verified: 生产真机——说「带我去看账单页面」，问询卡出现「带你打开账单页查看账单周期与费用记录？页面动作 · navigate · /console/billing」；点「执行」后URL 从 `/console` 变 `/console/billing`，副驾接着回「已带你切到账单页。页面上能看到…」。**答案回传的 404 已由 `authFetch` 修复**（此前显示「该问询已被回答或已失效」））
- [x] 3.3 未声明动词的反面验证（verified: 真机说「帮我把额度改成 999 分钟」——宿主只声明了 navigate/refresh，agent 回「改额度我确实做不到——我没有任何账户写操作工具」并给替代路径，`wx-embed-ask` 计数 = 0，无任何可执行选项）
- [x] 3.4 不动作验证（verified: 真机让 agent 提议跳配额页，问询卡出现（`wx-embed-ask`=1）但不点选，5 秒后 URL 仍停在上一步的 `/console/billing`，未发生任何跳转）

## 4. 宿主侧补齐

- [ ] 4.1 官网 `fd-official-web`：声明 `navigate`（站内锚点）——**代码已写并构建通过**，真机跳转待上游恢复后实测（verified: 待验）
- [ ] 4.2 柏讯 `fd-wire` 控制台：补 `context()` 递当前页面/数据集——**代码已写、tsc+build 通过**，真机待验（verified: 待验）
- [x] 4.3 柏讯控制台的 `intents` 收敛到路由白名单（verified: `src/copilotIntents.test.ts` 4 条用例通过——已知路由放行、回落成 home 的未知路由拒绝、站外 URL 与 javascript: 拒绝；wire 全量 71 文件 1105 用例绿）
- [ ] 4.4 谦面 `facet/web`：补 `context()`——**代码已写**（pathname 路由，popstate 时 push），真机待验（verified: 待验）

## 5. 上下文递送语义

- [ ] 5.1 前缀送达——**真机发现从未送达**：loader 把 host context 包在 `context` 字段、widget 读顶层，两端形状不一致，`contextPrefix()` 恒返回空串。已修（`normalizeHostContext` 收两种形状）+ 回归测试；待出片后重验
- [x] 5.2 上下文不触发动作（verified: 真机问「我在哪个页面？只说当前页面，不要跳转」——URL 保持在 `/console/billing` 未变、无问询卡；agent 如实说「我读不到你的页面状态」（当时上下文确实没送达，见 5.1）。修复后需重验「能读到且不擅自跳」这一半）

## 6. 出片与真机验收

- [ ] 6.1 四条线各跑三项真机（问询卡 / 宿主意图 / context）（verified: 每线三项逐条记录，用专用 testid 读，不用整页文本）
- [ ] 6.2 每次验收前清空 localStorage 与 cookie，硬重载（verified: 验收脚本里包含该步骤，且不依赖任何手动探针）

## 7. 壹座（门槛达成后另起）

- [ ] 7.1 三线四项全过后，在 **paas 仓**另起 change 做 `CopilotDock`（423 行）迁移（verified: 该 change 存在于 paas 的 openspec 根，本仓无 paas 改动）
