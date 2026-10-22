# 设计 — 意图信封的提示遵守度硬化

## Context

见 proposal.md 的 Why（自然语句下 `id` 写成 `nav_usage`，静默失败）。这里只记决定方案所需的事实。

**每回合进上下文的三样东西，显著度不同：**

```
始终在系统提示里（高显著度）
  A. persona.md ──────────► 带占位符：intent:navigate:<路径>
  B. ask_user_question 工具 schema（每次请求都带）
       工具级描述: "Use distinct stable question IDs."
       id 参数:    "Stable id for this question; echoed in the answer."

按需加载（可能整回合都没进上下文）
  C. skill 正文 ──────────► intent:<动词>:<参数>
       @deepseek-ai/dsh-skill-filesystem 的 list() 只返回
       name + description；get() 才读正文。
```

**观测到的失败形状**（`add-copilot-control-surface` 的 measurements 4.x）：问询卡形状全对（一个 question、`[执行, 跳过]`、question 文本自然），只有 `id` 失守。这个组合说明协议被读懂了，冲突只发生在 `id` 这一个字段上——而 `id` 恰好是 B 也有话说的字段。A 用尖括号占位符表述，读起来像说明；B 用模型最熟的词汇（stable id）说了两遍。flash 模型按 B 裁决。

**失败不可见**：`EmbedView.jsx` 的分支是 `if (intent) 执行 else submitAsk(...)`。走 else 时模型收到 `{id:"nav_usage", selected:["执行"]}`，没有任何错误信号，而 skill 写着「选『执行』且宿主成功：正常继续对话」。所以模型可能既没跳页、又确信成功了。生产侧没有任何回路会告诉它写错了。

## Goals / Non-Goals

**Goals**

- 让 `id` 这一个字段在自然语言下稳定成型，且证据来自生产同款模型、生产同款上下文（不含 skill 正文）。
- 把「靠人工走查发现」换成「铸版前自动拦」。
- 措辞由实测选定，不由手感选定。

**Non-Goals**

- 不改机制：`INTENT_RE`、确认卡渲染、`wx-copilot-intent` 握手、宿主白名单一行不动。
- 不改 `ask_user_question` 的工具描述（vendor 代码；且该约定只属于 copilot 面，写进通用工具会污染所有 agent）。
- 不引入专用工具（见 D7 的备选，本次不实施）。
- 不把评测推广到其他 pack（先证明这套评测本身有用）。

## Decisions

### D1 — persona 承载信封，skill 只承载长尾

信封的**字面形状**写进 persona（始终在上下文），skill 正文保留改口规则、一次一题、被拒后不重提等长尾纪律。

否决：把信封留在 skill 里加 few-shot。skill 是渐进披露的，模型不调 Skill 工具就看不到正文；把关键约束放进一个「可能没被打开的文件」，等于赌模型会去读。而且本次失败发生时它就没读——形状对说明它靠的是 persona 的摘要。

代价：persona 变长一点。缓解是 persona 里只放形状与裁决，机制解释留给 skill。

### D2 — 给字面完整调用，不给语法

persona 里写成可直接照抄、只替换路径的完整形状：

```
{"questions":[{"id":"intent:navigate:/console/usage",
  "question":"带你打开用量页查看本月统计？",
  "options":[{"label":"执行"},{"label":"跳过"}]}]}
```

否决：继续用 `intent:navigate:<路径>` 这种带占位符的表述。占位符读起来像说明性语法，模型会理解成「大意如此」而不是「逐字如此」。fingpt 被明示时能一次成型，说明能力在，缺的是字面锚点。

### D3 — 显式裁决 schema 冲突，而不是重复格式

persona 里加一句：`id` 不是语义标签；即使工具说明写着 stable id，本协议下 `id` 就是信封本身。

理由：B 在每一次请求里，且用的正是模型最熟的词汇。只加大 A 的音量而不裁决矛盾，模型仍可能按 B 理解。点名冲突并给出本场景的优先级，比默默覆盖更稳。

否决：在 A 里重复三遍格式。重复提升的是音量，不是优先级。

### D4 — 失败用后果表述，不用反例串

写「`id` 不以 `intent:` 开头 ⇒ 用户只会看到普通问询卡、页面不会跳，而你会以为成功了」，不写「不要写成 `nav_usage`」。

理由：反例串有可能被当成候选推进上下文（priming）。后果表述给的是语义钩子（我这样做会骗用户），比一个字符串更可泛化。这条是假设，不是定论——所以评测里 A/B 变体分开测，让数据裁决。

### D5 — 离线评测作为铸版门

`scripts/eval-intent-adherence.mjs`：镜像 `ask_user_question` 的真实工具 schema + 候选 persona + serving 车道模型（`AGENT_RUNNER_MODEL=deepseek-v4.1-flash`，经同一网关），跑固定语料（五个路径各一句自然说法 + 一句 refresh），每条重复 N 次，评分 `id` 是否匹配 `^intent:(navigate|refresh):` 且参数合法。

理由：生产侧没有反馈回路（D5 的前置事实见 Context），所以错一次就会一直错，且只有人工走查能发现。离线回放是唯一便宜的探测器，而且它把「措辞好不好」变成可比较的数字。

**四变体必须分开跑**：只加字面例 / +后果句 / +裁决句 / 全上。D4 的 priming 假设只能靠这个对照来验。

否决：直接上真机部署再人工试。每轮要重铸 + 重部署 + 真机探针，慢且不可重复；而且真机探针本身只能告诉你「这次成了」，不能告诉你「稳不稳」。

### D6 — 评测上下文必须与生产同形：不预载 skill 正文，且测第二回合

评测只放 persona + 工具 schema，**所有 skill 正文一律不进上下文**。同时语料按**第二回合**测（宿主 context 只在首回合作为标记前缀进入，见 `wanxing-web` 的宿主上下文需求）。

理由：如果评测预载 skill 正文，测的是一个生产里不一定出现的上下文，得到的通过率是假绿——这正是本项目记忆里反复出现的「验证没对准坏的那个本身」。本次失败就发生在第二回合、且很可能没读 skill。

### D7 — 备选（本次不实施）：专用工具 `propose_page_action`

参数是结构化的 `{verb, arg}`，信封由代码拼成 `intent:<verb>:<arg>` 再交给问询 provider——模型没有机会写错 `id`。

它比初看便宜：serving child 里 `ctx.userQuestions` provider 已经存在（`platform-serving-questions-bridge.js` 就是干这个的），所以新工具只是「注册一个工具 → 调 provider → 合成 id」。**widget 与宿主一行不用改**，它们照旧看到合规信封。成本是平台侧改动 + 一次出片 + 一个开关把工具关在非 embed agent 之外（例如 manifest 的 `serving.hostActions`）。

本次不选它的理由：fingpt 明示下能写对，说明是显著度竞争而非能力缺失；先用手上最便宜的杠杆（常驻通道 + 字面例 + 裁决）验证。若 v2 评测仍不过、或换模型后复发，D7 就是升级路径，spec 面不需要改（行为契约不变，只是承载从模型自觉变成代码保证）。

## Risks / Trade-offs

- **[flash 模型换版导致回归]** → 评测门是脚本，模型或车道变更时重跑即可；把「跑一次」写进 tasks 的验收步骤，而不是只跑一次就忘。
- **[离线评测与真机不等价]**（温度、网关、真实 persona 装配方式） → 镜像工具 schema 原文、用 serving 车道同款模型与网关、N 次重复；真机探针仍保留作为最终确认，两者不互相替代。
- **[反例串 priming]** → D4 用后果表述；A/B 变体分开测，实测若 B 明显差于 A 就丢掉 B。
- **[persona 变长挤压其他纪律]** → persona 只放形状与裁决；机制解释、改口规则留在 skill。
- **[同类静默失败仍在别处]**（`intent:refresh` 少冒号、option label 被加上 "(Recommended)"） → 已记在 proposal 的「已知邻接边」；评测语料含一句 refresh，若失败率高再单独立项，本 change 不顺手改机制。

## Migration Plan

1. 评测脚本先落，跑基线（现网 v1 persona）——记录当前命中率，作为「修好了」的对照。
2. 改 persona / skill 措辞，跑四变体，选通过率最高的组合。
3. 重铸 pack 为 v2（`POST /api/packs` 新版本）→ 既有 billingKey 流程重部署。
4. 若新版本 slug 与 v1 相同，`WIDGET_SLUG` 无需改动；若不同，同步 `fd-lex` 并出片。
5. 真机探针复验（自然语句 → 意图卡 → 点执行 → 宿主路由真变 → agent 收尾）。

**回滚**：重部署 v1 的 pack 版本即可（persona/skill 都在 pack 里，无镜像、无 env、无 widget 代码改动）。
