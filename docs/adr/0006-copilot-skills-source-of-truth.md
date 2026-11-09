# ADR-0006: 副驾技能的正式源在 finddata-skills，registry 是它的投影

日期：2026-11-10　起因：unify-cross-line-copilot 上产后副驾「装得上、答不出」

## 背景

跨线副驾上产后做真机验证，发现「识律控制台伴随助手」自 **2026-10-22 起零成功回合**：每次对话都以 `-32004 cold start failed after 4 attempts` 结束，`minutes=0`（计费前即失败）。抓原始 SSE 得到真因：

```
registry GET /api/skills/lex-console-tour/content → 404
```

顺着查，该 pack 声明的**四个技能全部不存在**于 registry：

| 技能 | registry `/content` |
|---|---|
| `lex-console-tour` | 404 |
| `lex-credentials-guide` | 404 |
| `lex-intent-protocol` | 404 |
| `lex-quota-billing` | 404 |

而它们的源文当时只存在于**本机 `docs/copilot-packs/lex-console-copilot/skills/`——该目录不在任何 git 仓内**（工作区根不是仓）。也就是说：registry 里的登记被删/未登记，唯一的副本躺在一台笔记本的未纳管目录里，冷启动必然失败，且这个失败方式**不报错给调用者之外的人**（只有回合台账里一行 `outcome=error, minutes=0`）。

## 裁决

1. **技能的正式源是 `finddata-skills`（gitee `FindDataTechnology/finddata-skills`），registry 条目只是它的投影。** 新增/修复技能一律先把 `SKILL.md` 落到该仓（按板块目录，如 `lex-console/<skill>/SKILL.md`），再从 gitee raw URL 登记进 registry（与既有 20 条活跃技能同一形态）。
2. **禁止「只登记不落仓」**：`POST /api/skills` 的必填字段是 `skill_md_url`，registry 会回源拉取——URL 背后没有版本化的源，就等于一条随时会 404 的引用。
3. **pack 内联 `content` 不是保险**：本 pack 的 manifest 已内联四段正文，运行时仍然按技能名回 registry 展开。因此「manifest 里有内容」不能作为跳过登记的理由。
4. **跨线写要有探测前置**：registry 属謙面，属借用边界。写入前用无副作用的 `POST /api/skills/check-duplicates` 探权限（带令牌 200 / 不带 401），不拿生产当试验场；写入后逐条验 `GET /api/skills/<name>/content` 返回 200。

## 后果

- 四个技能已落仓（`finddata-skills` `9708da2`）并登记（`/skills/lex-console-*`），`content` 四条均 200；同一部署复测 SSE 正常流式回答，`-32004` 消失。
- **副驾的可用性依赖一条跨线链路**：pack（谦面）→ 技能（finddata-skills → registry）→ agent 冷启动（agent-runner）→ 门面（萬星）。任何一环把它当"已经配好了"都会表现为「副驾装了但答不出」。
- 排查口诀：**副驾不答先看回合台账的 `outcome/minutes`**——`error` 且 `minutes=0` 是上游/冷启动，不是身份、计费或 loader；再去抓原始 SSE 拿 `code` 与失败的那条 `GET`。
- 已知未办：`WANXING_EMBED_ORIGINS` 平台级 fallback 为空，每条线须逐 agent 开允许来源；多线共用同一副驾属另一个决策。
