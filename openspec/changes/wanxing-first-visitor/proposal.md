# 萬星第一访客体验（wanxing-first-visitor）

## Why

萬星是核心产品条线但目录第一屏是内部验收现场：线上 22 个 agent 大半带「M4①/M5.3 验收」迭代代号、`turns7d` 全 0、无定价/About/状态页；对接文档第一条 curl 就是字面量 `$BASE`（A2aSample.jsx:6，全站无一处赋值）——第一个真实访客/对接者会在第一屏和第一行命令上流失。无真实客户期是清洗目录、立信任面的唯一无成本窗口。

## What Changes

**目录可信度**
- 验收 agent 退役/私有化（用户 2026-11-06 裁决）：目录接口与页面只呈现真实可服务的 agent；验收部署下线或转私有，描述去迭代代号。
- agent 详情：卡片可点进详情视图（能力/示例问题/最近活跃/对话入口），活跃徽章（turns7d）在有真实数据后自然生效。

**对接断点**
- `$BASE=https://wanxing.finddatatech.cloud` 写实进 A2aSample/DocsView，补三行快速开始；文档列出 `.well-known/agent-card.json` 发现端点与 caller 偏好 API（prefs 目前全站零曝光——先文档曝光，不退役）。

**信任三件套**
- 页脚状态条：catalog 总数/7 天回合数/结算 pending（数据源 `fleet/v1/board` 公开安全子集），配 facade 公开 health/status 只读端点（`/healthz` 现公网 404）。
- IntroView 补定价说明（沿用现有计费描述成表）与「关于萬星」段。

**粗边收敛**
- OpsView：非 ops 身份隐藏 ops 专属面板（现在渲染后必 403）。
- CollectionsView：删除集合加确认与错误态（现 fire-and-forget）。
- ChatView：历史清除/导出入口（现 localStorage 200 条上限无出口）。
- embed/copilot 车道补一个可运行的静态宿主示例页（postMessage init/context/intents 可复制演示）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-web` — 目录清洁呈现、详情视图、信任三件套、chat 历史出口、embed 宿主示例、ops 面板显隐、删除确认。
- `wanxing-facade` — 公开 status 只读端点、目录只含可服务 agent 的呈现规则、文档曝光面（agent-card/prefs）。

## Non-goals

- 不做新计费能力，定价页只陈述现行口径。
- 不动 chat/SSE 协议与 A2A 契约本身。
- 不做 i18n、不做 SEO 专项。
- prefs API 行为不变，只补文档。

## Impact

- `wanxing-web/src/views/`（Catalog/Docs/Intro/Chat/Embed/Console/Ops/Collections）、`wanxing-web/nginx.conf`（status 路径转发）、facade `a2a.js/routes.js`（status 端点+目录过滤）。
- 验收 agent 下线涉及 paas/facet 部署台账操作（任务级列明，不改契约）。
- 下游：turns7d 徽章依赖 catalog 清洗后真实使用数据。
