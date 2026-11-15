# Tasks — unify-wanxing-surface-language

## 1. 状态事实单源（基石）

- [x] 1.1 新增 `wanxing-web/src/status-facts.js`：`factOf({status, health})` 按 D1 优先级链返回七种事实之一，`badgeFor(fact)` 返回 `{label, cls, title}`，`factLabel(fact)` 供各处复用；`npm test` 里新增 `status-facts.test.mjs` 覆盖七种事实 + 优先级冲突组合（verified: 单测全绿，且含一条「failing + serving → failing」的冲突用例）
- [x] 1.2 验证 `status-facts.js` 零依赖、纯函数：`node --import ./test/register.mjs --test test/status-facts.test.mjs` 在无 DOM、无 fetch 的情况下通过（verified: 命令输出 0 fail）
- [x] 1.3 在 `status-facts.test.mjs` 里固定「一枚主徽标」判据：给定 `{status:'serving', health:{health:'failing'}}`，`factOf` 只返回 `failing`，且 `badgeFor` 输出不含任何健康类措辞（verified: 断言 label 不含「运行中」「在役」）

## 2. 目录与详情面（访客侧消费）

- [x] 2.1 `CatalogView.jsx`：删掉本地 `STATUS_UI`，`statusBadgeFor()` 改走 `badgeFor(factOf({status: a.status, health: a.health}))`；`allStatusesUnknown()` 判据不变（verified: `test/views.test.jsx` 既有目录断言仍全绿，且 `status-badge-<slug>` testid 保留）
- [x] 2.2 `CatalogView.jsx`：`a.tags` 渲染过 `label()` 字典；未命中项原样输出；原始值保留在 `title`（verified: 新增一条断言——`security-pending` 渲染为中文且 `title` 含原文；未命中标签 `xyzzy` 原样出现）
- [x] 2.3 `CatalogView.jsx`：`skills`/`slug` 折叠在两者皆空时不渲染，卡面补一句「对话即试用」引导（verified: 造一个 `skills: []` 的夹具，断言页面不出现「（未声明）」）
- [x] 2.4 `AgentDetailView.jsx`：标题行补主徽标（今天只有「可对话」），走同一个 `factOf`/`badgeFor`（verified: 详情页出现 `agent-detail-status` testid，且 failing 夹具下只出一枚徽标）
- [x] 2.5 新增 `wanxing-web/src/labels.js` 标签字典（`wire/lex/facet/yizuo/security-pending/M2` 等），导出 `label(t)`；配一条单测锁「未命中原样返回」（verified: `labels.test.mjs` 通过，含未命中用例）

## 3. 舰队卡（部署者侧消费）

- [x] 3.1 `FleetView.jsx`：删掉 `d.paused ? 已暂停 : 运行中` 药丸，改为主徽标 = `badgeFor(factOf({status, health}))`（verified: 生产/夹具下 failing agent 卡片只有一枚红徽标，`fleet-health-<slug>` testid 仍存在）
- [x] 3.2 `shared.jsx`：`HealthBadge` 内部改调 `badgeFor`，**导出名与 `fleet-health-<slug>` testid 不变**（verified: 既有 `views.test.jsx` 中所有 health 断言不改一行仍通过）
- [x] 3.3 `FleetView.jsx`：用量 summary 为 null 时三格保持占位；summary 有值且三项全 0 时跨三列渲染一句「尚无调用记录」（verified: 追加两条夹具断言——null 时不出现 `0`／`$0.00`；全零时出现该句且不出现 `$0.00`）
- [x] 3.4 `FleetView.jsx`：操作区改为「主操作留卡面（暂停/恢复 + 对话入口）+ 其余五项收进 `<details>` 更多入口」，**七个按钮的 onClick / 端点 / testid 一字不改**（verified: 逐个点开六个面板走查，每个 testid 与分层前一致；`views.test.jsx` 若有按钮断言需保持绿灯）

## 4. 运维面（口径与可读性）

- [x] 4.1 `OpsView.jsx`：顶行 states 枚举改走 `factLabel()` 中文，原始枚举放 `title`（verified: 页面无裸英文枚举直出；悬停可见原值）
- [x] 4.2 `OpsView.jsx`：加口径脚注——板统计窗口内被观测到的 agent，与页脚「N 个 agent 在役」不同口径，两者不等不是故障（verified: 页面上有一处可见小字 + `title`，文案固定）
- [x] 4.3 `OpsView.jsx`：无 `runner_stats` / 无任务 / 无 `cells` 三处空态补「为什么空 + 去哪看」（verified: 三处空态文案各自含下一步指引，而非仅「窗口内无 X」）

## 5. 规格与治理

- [x] 5.1 `openspec/specs/wanxing-web/spec.md` 的「三 tab」要求随本 change 的 MODIFIED delta 一并更新（verified: `openspec validate unify-wanxing-surface-language --strict` 通过；archive 后主 spec 含五 tab 文本）
- [x] 5.2 paas 侧前置依赖已登记：18 个 pack 需在 serving 契约声明 `card.examples`（产出点 `paas/lib/agent-serving.js:254`），按 workspace 约定另起一条 paas change；本刀只保证「未声明不难看」（verified: 依赖写在 proposal 的 Impact 段与本行，且本刀不因此阻塞）

## 6. 出片与生产验收

- [x] 6.1 `cd wanxing-web && npm test` 全绿（verified: 测试输出 0 fail，且新增的 status-facts/labels 测试被纳入 glob）
- [ ] 6.2 走 fd-wanxing 标准线出片：GHA → hkccr → 回灌 ccr `yizuo/wanxing-web` → fd-infra-deploy 滚 tag → ArgoCD（verified: ccr 上有新 sha tag，ArgoCD 同步完成，pod 内镜像 tag 与提交一致）
- [ ] 6.3 生产四点走查：目录 / agent 详情 / 舰队卡 / 运维板，逐点确认状态主徽标唯一、无假零、运维板无裸枚举（verified: 四张生产截图归入 `gui-test-screenshots/`，逐点人工核对）
- [ ] 6.4 反向验证「坏的看起来就是坏的」：对一个真实 agent 造出 failing 观测态（或使用既有 failing 窗口），确认任一面上**只出一枚**「持续失败」徽标、且无并列「运行中」（verified: 截图或观测面板读数，这是本刀唯一无法用静态断言证明的验收项）
