# 意图信封的提示遵守度硬化（识律 copilot pack v2）

## Why

`add-copilot-control-surface` 上产后，正式识律 pack 的真机探针坐实一个缺口：用户自然说「带我去用量页」时，agent 确实发出了问询卡、选项也确实是 `[执行, 跳过]`，但 question 的 `id` 写成了自命名的 `nav_usage`，不是协议要求的 `intent:navigate:/console/usage`。`INTENT_RE` 不匹配 ⇒ 卡片退化成普通问询，点「执行」只是答题，页面不动。

而这条失败是**静默的**：widget 走 else 分支回 `{id:"nav_usage", selected:["执行"]}`，模型收到的答案里没有任何错误信号，而 skill 又写着「选『执行』且宿主成功：正常继续对话」——模型有理由相信自己成功了。机制层无缺陷（fingpt 被明示时一次成型），坏的是提示遵守度；但因为它不留痕，一次没修好就会一直重复，且只靠人工走查才能发现。

诊断不是「措辞不够硬」。`ask_user_question` 的工具描述说了两遍 `stable id`（工具级 "Use distinct stable question IDs." + 参数级 "Stable id for this question; echoed in the answer."），而 persona 只给了带占位符的 `intent:navigate:<路径>`。schema 与文档在**同一个字段**上冲突，flash 模型按 schema 的字面语义裁决了。补一个 few-shot 只是加大文档音量，没有裁决矛盾——而且 skill 正文是渐进披露的，persona 才是常驻通道，写错地方等于赌模型会去读。

## What Changes

- **persona 承载信封，skill 只承载细节**。把意图信封写成 persona 里的**字面完整调用形状**（可直接照抄、只替换路径），并加一句显式裁决：`id` 不是语义标签，即使工具说明写着 stable id，本协议下 `id` 就是信封本身。skill 正文继续放改口规则、纪律等长尾内容。
- **失败以后果表述，不以反例表述**。「id 不以 `intent:` 开头 ⇒ 用户只会看到普通问询卡、页面不会跳，而你会以为成功了」——点名后果而不是点名错误串，避免把 `nav_usage` 当作候选推进上下文。
- **离线遵守度评测作为铸包前置门**。一个脚本：真实 `ask_user_question` 工具 schema + 候选 persona + serving 车道模型（`deepseek-v4.1-flash`），用固定语料（五个路径各一句自然说法 + 一句 refresh）重复 N 次，评分 `id` 是否匹配 `^intent:(navigate|refresh):` 且参数合法。四变体分开测（只加字面例 / 加后果句 / 加裁决句 / 全上），用数据而不是手感决定最终措辞。
- **评测通过后重铸并重部署 pack v2**，再用同一条真机探针（自然语句出意图卡 → 点执行 → 宿主路由真变 → agent 收尾）复验。
- **不做**：改 widget 或宿主的机制（`INTENT_RE`、`wx-copilot-intent` 协议、宿主白名单一行不动）；改 `ask_user_question` 的工具描述（vendor 代码，且该约定只属于 copilot 面）；把信封挪到 `detail`/`header`/option label（ADR-0004 已否决，理由不变）；新增专用工具（见 design.md 的 T3 备选，本次不实施）；把该评测推广到其他 pack。

## Capabilities

### New Capabilities

- `copilot-intent-adherence`：copilot pack 的动作协议在**自然语言**下必须成立——给一句导航诉求，问询 id 就是意图信封；且 pack 铸版/换 persona 前必须过离线遵守度评测门（含四变体对照与评分口径）。

### Modified Capabilities

_无。`wanxing-web` 的意图执行机制不改（`INTENT_RE`、确认卡、宿主握手逐字节保持）；本 change 只约束 pack 内容与它的验证门。_

## Impact

- 内容：`docs/copilot-packs/lex-console-copilot/persona.md`（信封字面形状 + 裁决句 + 后果句）、`skills/lex-intent-protocol/SKILL.md`（改为承接 persona、补长尾纪律，删与 persona 重复的格式说明）、`skills/lex-console-tour/SKILL.md`（「何时发起 navigate」一节的措辞对齐）。
- 工具：新增 `scripts/eval-intent-adherence.mjs`（离线评测；读候选 persona、镜像工具 schema、跑 serving 车道模型、输出每变体命中率与失败样本）。
- 上架：pack 重铸为 v2（`POST /api/packs` 新版本）→ 重部署（既有 billingKey 流程）→ `WIDGET_SLUG` 若 slug 变化则同步（同 slug 新版本则无需改 lex web）。
- 无新镜像、无新 env、无 widget/宿主代码改动；依赖 serving 车道 `AGENT_RUNNER_MODEL=deepseek-v4.1-flash` 可用（既有）。
- 文档：`docs/adr/0004-host-intents-ride-question-ids.md` 的「实证与后果」节把「提示遵守度是运营面问题」更新为已处置（persona 常驻承载 + 评测门），并补记 schema 冲突这一根因。

## 已知邻接边（本次不处置）

- `intent:refresh:` 是冒号结尾、参数为空。模型若写成 `intent:refresh`（少一个冒号），`INTENT_RE` 不匹配，落进同一类静默失败。放宽正则尾部冒号是一行改动，但属 widget 机制面，不在本 change 范围；评测语料会覆盖 refresh 一句，若失败率高再单独立项。
- 工具描述里 "If you recommend one, put it first and append \"(Recommended)\" to that label" 与 skill 的 `[执行, 跳过]` 不冲突（都要求推荐项在前），但模型若照做会渲染成「执行 (Recommended)」。仅文案变丑，功能不受影响。
