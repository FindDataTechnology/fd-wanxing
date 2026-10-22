# measurements — harden-copilot-intent-envelope

## 1. v1 基线（现网 persona，2026-10-22）

命令（可照抄复现）：

```
cd fd-wanxing
node scripts/eval-intent-adherence.mjs \
  --persona ../docs/copilot-packs/lex-console-copilot/persona.md \
  --runs 5 --json /tmp/eval-baseline-v1.json
```

车道：`finddata` / `https://token.finddatatech.cloud/v1` / `deepseek-v4.1-flash`（凭据取自 `~/paas/llm-providers.json`，脚本不存密钥）。上下文只有 persona + 工具 schema，**无任何 skill 正文**。

结果：**7/35 = 20%**。

| 语料 | 通过 | 实测 id |
|---|---|---|
| usage | 0/5 | `nav_usage` ×5 |
| quota | 0/5 | `nav_quota`, `intent:navigate:/quota`, `navigate_quota`, `nav_quota`, `navigate_quota` |
| billing | 0/5 | `nav_billing` ×4, `intent:navigate:/billing` |
| credentials | 1/5 | `nav_credentials` ×4, `intent:navigate:/console/credentials` |
| overview | 0/5 | `intent:navigate:/overview` ×2, `nav_overview` ×3 |
| refresh | 1/5 | `intent:refresh:`, `refresh_current`, `refresh_current_page`, `refresh_confirm` ×2 |
| control-where | 5/5 | — |

三条结论：

1. **生产故障被确定性复现**：`usage` 五跑五次全是 `nav_usage`。
2. **失败不止一类**。除了已知的语义 id，还有 `intent:navigate:/quota`（信封对、**漏了 `/console` 前缀**）与 `intent:navigate:/overview`（**凭空造了不存在的路径**）。根因：persona 只写「路径限五个控制台路由」却从不列举这五个，清单只存在于不一定被读的 skill 里。
3. **对照项 5/5**，即 v1 不会把「用量在哪看」误当动作——这成为后文的回归基准。

## 2. 变体对照（各 `--runs 5`，共 7 变体 × 35 次）

| 变体 | 内容 | 通过 | 对照项 | 备注 |
|---|---|---|---|---|
| v1 基线 | 现网 | 7/35 = 20.0% | 5/5 | 复现 `nav_usage` |
| A0 | 只把五个路径枚举进 persona | 10/35 = 28.6% | 4/5 | **几乎无改善**：`nav_usage`×4、`nav_intent_001`、`navigate_intent_1`、`intent_refresh` |
| A | A0 + 字面完整调用 | 31/35 = 88.6% | 2/5 | 五个路径全过；`billing` 4/5 |
| B | A + 后果句 | 32/35 = 91.4% | 2/5 | |
| C | A + 冲突裁决句 | 30/35 = 85.7% | 1/5 | `quota` 4/5 |
| D | A + 后果句 + 裁决句 | 34/35 = 97.1% | 4/5 | 唯一失败项是对照项 |
| E2 | A + 区分规则（无后果句/裁决句） | 28/35 = 80.0% | 5/5 | `billing` **0/5**（模型干脆不再提议动作） |
| **E** | D + 区分规则 | **35/35 = 100%** | **5/5** | 采用 |

### 三条实测结论

**① 字面完整调用是承重件，路径枚举不是。** A0（只枚举路径）28.6%，相对基线几乎没动；A（加字面例）跳到 88.6%。所以「往 skill 加 few-shot」这个方向本身没错，错在**放在哪一层**和**给不给字面量**。

**② 后果句与裁决句都承重，缺了会掉。** E2（去掉这两句）掉到 80%，其中 `billing`「我要看账单」0/5——模型干脆不发问询了。两句不是修辞，是让模型既有动机（不写对就是骗用户）又有裁决依据（schema 说 stable id，本协议下不算）。

**③ 硬化本身会引入过触发，必须配套区分规则。** 对照项从基线 5/5 退化到 D 4/5、B 2/5、C 1/5——模型开始把「用量在哪看」当成「带我去」。这不是措辞瑕疵，而是违反 spec 需求 1 的场景「只问在哪看不算动作」。加区分规则后恢复 5/5（E、E2 都是）。

**④ 后果句没有出现 priming。** design D4 担心「点名 `nav_usage` 会把错误串推进候选」；实测 B（含后果句）对照项 2/5 与 A（无）相同，`usage` 都是 5/5，未见该迹象。但真正的判据是整体通过率，与 priming 无法分离，故仍按 E 采用。

## 3. 最终选定

采用 **E**，已落盘 `docs/copilot-packs/lex-console-copilot/persona.md`。落盘后又把「回头告诉她」改成「回头告诉用户」（中性表述），改动后**重跑确认**：`--persona ../docs/copilot-packs/lex-console-copilot/persona.md` → **35/35 = 100%**，七个语料项全部 5/5。

最终 persona 的承重内容（按作用分）：

- 五个路径**逐字列举**，并点名 `/overview`、`/quota` 是错的；
- 两个**字面完整调用**（navigate 与 refresh 各一），可直接照抄只换路径；
- **后果句**：`id` 不以 `intent:` 开头 ⇒ 普通问询卡、页面不跳、而你以为成功了；
- **裁决句**：工具说明的 "Stable id" 是默认约定，本协议下 `id` 就是信封；
- **区分规则**：「带我去/打开/回」= 动作；「在哪看/怎么看」= 直接答路径，不发卡。

## 4. 真机探针（2026-10-22，v2 上线后）

部署：`POST /api/packs/XfyXvzONQFelnFIgM0dJVw/versions/2/deploy`（facet 集群内 loopback，身份
aloadtree@gmail.com 带 `creators`；延续既有 billingKey 绑定，返回 `billing.linked=true, balance=50.29`）。
核对：`internal/deployments` 该 agent `version: 2`；`chat/<slug>/embed-config` 三项
`chatAble/anonymous/asks` 均 true。slug 未变（`packs-xfyxvzonqfelnfigm0djvw-lex-console-copilot`，5.3 记为无需改动）。

探针走对话车道：匿名访客 `visitor-token`（origin=`https://lex.finddatatech.cloud`）→
`chat/<slug>` `message/stream`。三条，均**自然语句、零格式提示**：

| 语句 | 问询帧 | 点「执行」 | agent 收尾 |
|---|---|---|---|
| 带我去用量页 | `id = intent:navigate:/console/usage`（`question`「带你打开用量页查看本月统计？」；选项 执行/跳过） | `ask-answer` → `{"accepted":true}` | 「你已选「执行」，跳转指令已提交给页面，用量页马上打开。」+ 三条读数指引 |
| 刷新一下当前页面 | `id = intent:refresh:`（空 arg） | `{"accepted":true}` | 「已提交刷新请求，页面数据正在重载。」+ 无变化时的两条排查建议 |
| **对照**：用量在哪看 | **0 张卡**（帧种类只有 delta/message/done） | — | 直接答「路径是 `/console/usage`」并问「需要我直接带你打开用量页吗？」 |

徽标文案由 widget 从 id 解析（`EmbedView.jsx:723`：`页面动作 · {verb} · {arg}`），故上表第一行
即对应「页面动作 · navigate · /console/usage」。宿主路由真变属宿主侧行为，已由
`add-copilot-control-surface` 的验收覆盖，本次不重复验证。

三条结论：

1. **生产故障已消失**：同一句「带我去用量页」，v1 出 `nav_usage`（普通问询卡、页面不跳），v2 出
   `intent:navigate:/console/usage`，点执行后 receipt `accepted:true`。
2. **对照项未过触发**：只问「在哪看」时不发卡，符合 spec 需求 1 的「只问在哪看不算动作」。
3. **两种动词都在线**：navigate 带路径、refresh 空 arg，形状与离线评测口径一致。

## 5. 重跑口径

模型或 serving 车道变更时，重跑第三节的命令即可（脚本镜像了真实工具 schema，评分只看 `id` 是否匹配 `^intent:(navigate|refresh):` 且参数合法）。若上游吐 502，脚本已带 6 次指数退避；仍失败则以退出码 2 区分「配置/网络问题」与「不通过（1）」，不要把 2 当成措辞回归。
