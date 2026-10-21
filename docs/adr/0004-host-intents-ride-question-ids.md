# ADR-0004：宿主意图骑 question id，确认即问询

- 日期：2026-10-21
- 状态：Accepted（change `add-copilot-control-surface`；姊妹 paas `add-serving-ask-bridge` / ADR-0029）

## 背景

E3 操控面要让嵌入 widget 里的 agent 提议页面动作并由宿主执行。dsh `ask_user_question` 的 seam 侧 question schema 为 strict（`id/question/header?/detail?/options?/multiSelect?`），option 只有 `label/description`、无 id，未知字段在 seam 被丢弃——想象中的「ask 的 intent 字段」过不了缝。

## 决策

1. **意图信封 = question `id` 前缀** `intent:<verb>:<arg>`。它是唯一既模型可控、又原样回到答案里（`answers[].id`）的结构承载位；agent 天然知道自己问的是哪条意图。
2. **确认 = 问询本身**：意图必经问询卡、必经用户点击；pack 约定 options 固定 `[执行, 跳过]`，**第一选项即执行**，widget 不猜测标签语义。「写操作强制确认」由形态保证。
3. **宿主能力在 init 声明，widget 永不自行执行**：`wx-copilot-init.intents[]` 列动词；未声明/无宿主一律答「当前页面不支持」。意图消息只发可信 origin；宿主 8s 不回视为失败并随答案告知 agent。
4. **宿主执行即界面刷新**：动作由宿主在自己页面上做，不需要额外的变更事件流。

## 实证与后果

- fingpt 在明示下一次成型 `intent:navigate:/console/usage`；正式识律 pack（skill 内有协议）首探自命名 `nav_usage`——**提示遵守度是运营面问题**（v2 强化 skill 措辞/few-shot），机制层已证。
- 匿名访客与登录访客同白名单（navigate/refresh 只影响访客自己的页面）；未来写动词必须加 tier 门。
- 否决：解析 option label 前缀（污染给人看的文案）、`detail` 塞 JSON（同为文本约定且更不可靠）、引入 CopilotKit（并行会话栈+卡片系统，且不解跨产品身份）。
