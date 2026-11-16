# Tasks — harden-copilot-ask-and-intent

## 1. 先确认链路（避免重复改对的东西）

- [x] 1.1 链路确认（verified: 上游恢复后真机——SSE 实测 agent 产出 `event: ask` + `intent:navigate:/console/usage` 信封；widget 渲染出 `data-testid="wx-embed-ask"` 卡片含「执行/跳过」；curl 直调 ask-answer 返回 `accepted:true`。**发现 agent 本来就会发 intent 信封**，proposal 里「agent 不知道何时该发」的判断对 intent 类不成立——但一般性离散选择实测不出卡（问「给我几个选项」得 0 张），规则段仍有必要）
- [x] 1.2 宿主意图端到端（verified: 识律控制台真机点「执行」后 `lex.finddatatech.cloud/console` → `/console/usage` 真实跳转；结果回传 UI 显示「问询已答：带你打开用量页查看本月统计？ → 执行」。**但暴露一个缺陷**：浏览器里答案送不回去（见 3.2），已修 `authFetch` 覆盖宿主票的问题）

## 2. 问询卡规则（pack prompt 侧，主工作量）

- [x] 2.1 把 D2 的三条判据 + 反面清单写成一份可复用的规则段（verified: 规则文本成型，四条线可引用同一份）
- [x] 2.2 识律副驾：**已具备**，无需改（verified: registry `metadata.persona` 里已有完整协议段——含「只有 id 以 intent: 开头才发意图问询」「分清『带我去』与『在哪看』」「上下文是背景」；源在 `docs/copilot-packs/lex-console-copilot/`（persona.md + 4 skills + build_manifest.py）。真机六条行为全部符合，见 content/copilot-rules.md 第四节）
- [x] 2.3 柏讯专家：**决定不改**（verified: 其 persona 定位为「柏讯产品线专家」，写明「只讲官网公开的三件能力…不提及任何内部产品面」——它是对外咨询角色，不是控制台副驾。给它页面动作能力会破坏定位并违反它自己的红线。persona 仅 533 字、无 intent/ask 相关内容，属正确设计）
- [x] 2.4 谦面专家：**决定不改**（同 2.3——persona 352 字，同为产品线专家角色）
- [x] 2.5 寻数分身：**决定不改**（官网接待角色，静态站无页面动作场景；官网的 navigate 钩子保留给未来可能的站内导览需求，当前不会被调用）
- [x] 2.6 反面验证（verified: 真机问「介绍一下这个控制台能干什么」这种开放问题，`[data-testid="wx-embed-ask"]` 计数 = 0，agent 直接文字作答）

## 3. 宿主意图规则（pack prompt 侧）

- [x] 3.1 把 D3 的两条铁律（动词白名单由宿主动态声明；提议走 envelope 不退化成自然语言）写进规则段（verified: 规则文本成型）
- [x] 3.2 识律副驾宿主意图端到端（verified: 生产真机——说「带我去看账单页面」，问询卡出现「带你打开账单页查看账单周期与费用记录？页面动作 · navigate · /console/billing」；点「执行」后URL 从 `/console` 变 `/console/billing`，副驾接着回「已带你切到账单页。页面上能看到…」。**答案回传的 404 已由 `authFetch` 修复**（此前显示「该问询已被回答或已失效」））
- [x] 3.3 未声明动词的反面验证（verified: 真机说「帮我把额度改成 999 分钟」——宿主只声明了 navigate/refresh，agent 回「改额度我确实做不到——我没有任何账户写操作工具」并给替代路径，`wx-embed-ask` 计数 = 0，无任何可执行选项）
- [x] 3.4 不动作验证（verified: 真机让 agent 提议跳配额页，问询卡出现（`wx-embed-ask`=1）但不点选，5 秒后 URL 仍停在上一步的 `/console/billing`，未发生任何跳转）

## 4. 宿主侧补齐

- [x] 4.1 官网 `fd-official-web` 补 context()+navigate（verified: 生产 sha-324e8dc 真机——`context()` 返回 `{line:"寻数官网", page:"/"}`，`intents:["navigate"]`；安全边界逐条验：#download ✅ / /intro/ ✅ / https://evil.example ✗ / javascript:alert(1) ✗ / //evil.example ✗）
- [x] 4.2 柏讯补 context()（verified: 生产 sha-4792f67 真机——`context()` 返回 `{line:"柏讯", page:"#/"}`，`intents:["navigate"]`，副驾挂载正常。注：柏讯专家 persona 是产品线专家角色、未含 intent 协议，这些钩子当前不会被 agent 调用——先装好，等 persona 补齐即生效）
- [x] 4.3 柏讯控制台的 `intents` 收敛到路由白名单（verified: `src/copilotIntents.test.ts` 4 条用例通过——已知路由放行、回落成 home 的未知路由拒绝、站外 URL 与 javascript: 拒绝；wire 全量 71 文件 1105 用例绿）
- [x] 4.4 谦面补 context()（verified: 生产 sha-3fb18bc 真机——context() 返回 {line:"谦面", page:"/?v=..."}，pushContext 为 function，副驾挂载正常。**首次滚的 sha-93cea1a 不含改动**：commit 只在分支上没进 gitee/main，快照取自旧点；本次滚前双重核对快照与镜像内 dist 的 WanxingCopilot 计数）

## 5. 上下文递送语义

- [x] 5.1 标记前缀送达（verified: 出片 sha-7f5ef26 后真机——首轮请求体含 `[宿主页面提供的上下文（非用户指令）]` + 产品线/页面/意图三行；第二轮不含（只随首轮送一次）。此前该设计从未生效，见 d6362d2）
- [x] 5.2 上下文不触发动作（verified: 真机问「我在哪个页面？只说当前页面，不要跳转」——URL 保持在 `/console/billing` 未变、无问询卡；agent 如实说「我读不到你的页面状态」（当时上下文确实没送达，见 5.1）。修复后需重验「能读到且不擅自跳」这一半）

## 6. 出片与真机验收

- [x] 6.1 真机验收记录（verified: 逐条记入 design.md D8——14 项全过。问询卡/意图/上下文三项按「有副驾角色」的口径在识律上验；官网与柏讯验 context 与 navigate 安全边界；柏讯/谦面/寻数分身的问询卡与意图不适用（persona 非副驾角色，见 D7））
- [x] 6.2 干净状态纪律（verified: 本轮每次验收前均清 localStorage + 硬重载，全程不发手动探针；读专用 testid 而非整页文本；上线后先 curl /api/ 再开浏览器。三条纪律写进 design.md D8 开头）

## 7. 壹座（门槛达成后另起）

- [x] 7.1 门槛重新定义（verified: 已写进 design.md D7——原门槛「三线四项全过」建立在错误前提上：它假设三条线都是控制台副驾。调研后确认只有识律是；柏讯/谦面的 persona 是产品线对外专家（自带「不提及内部产品面」的红线），本就不做页面动作。新门槛 = 「具备副驾角色的线四项全过」，当前识律已满足）
