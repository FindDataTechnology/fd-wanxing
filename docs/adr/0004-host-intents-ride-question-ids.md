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

- fingpt 在明示下一次成型 `intent:navigate:/console/usage`；正式识律 pack（skill 内有协议）首探自命名 `nav_usage`。
- **根因（2026-10-22 实测修正）**：不是「提示遵守度」这种运营面问题，而是 `ask_user_question` 的 **schema 描述与本文档的信封约定在同一字段上冲突**——工具说明连着两处写 "stable id for this question"，flash 档模型按 schema 裁决，于是把 `id` 填成语义标签 `nav_usage`。冲突不裁决，加多少遍「路径限五个控制台路由」都无效（只枚举路径的变体仅从 20% 到 28.6%）。
- **处置**（change `harden-copilot-intent-envelope`）：persona 常驻承载字面完整调用（`intent:navigate:/console/usage` 可照抄只换路径）+ 后果句（不以 `intent:` 开头 ⇒ 普通问询卡、页面不跳、而模型以为成功了）+ 裁决句（工具说明的 "stable id" 是默认约定，本协议下 `id` 就是信封）+ 区分规则（「带我去/打开/回」= 动作；「在哪看/怎么看」= 直接答路径）；skill 不再重复语法。**离线评测门** `scripts/eval-intent-adherence.mjs` 把措辞改动的效果变成数字（v1 20% → 选定变体 100%），真机复验三探针通过（navigate / refresh / 对照项）。
- **D7 备选仍留在桌面**：若上游 schema 未来把 `id` 语义再收紧到不可覆盖，则改走「seam 侧新增结构化字段」的路线；现方案的前提是 id 为自由字符串。
- 匿名访客与登录访客同白名单（navigate/refresh 只影响访客自己的页面）；未来写动词必须加 tier 门。
- 否决：解析 option label 前缀（污染给人看的文案）、`detail` 塞 JSON（同为文本约定且更不可靠）、引入 CopilotKit（并行会话栈+卡片系统，且不解跨产品身份）。
