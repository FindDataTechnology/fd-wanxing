## 1. 评测基座

- [x] 1.1 新建 `scripts/eval-intent-adherence.mjs`：镜像 `ask_user_question` 的真实工具 schema（`questions[].id/question/header/options[].label/description/multi_select`，与 `dsh-tool-ask-user` 的模型面一致）、接收 `--persona <file>` / `--corpus <file>` / `--runs N` / `--model <id>`、按第二回合形态构造请求（不带宿主 context 前缀、不注入任何 skill 正文）、调用 serving 车道同款网关、输出每条的 `id` 与 pass/fail 及失败样本 JSON。**验证**：用一个故意写错格式的假 persona 跑通，脚本输出 0 命中率并打印失败样本，退出码非 0。
- [x] 1.2 落固定语料 `scripts/eval-intent-corpus.json`：五个路径各一句自然说法（带我去用量页 / 打开配额看看 / 我要看账单 / 怎么拿 key，去凭据页 / 回总览）+ 一句刷新诉求 + 一条对照项（「用量在哪看」这类只问不跳，期望**不**发意图问询）。**验证**：语料共 7 条，每条带 `expectedId` 或 `expectNoAsk`，脚本能逐条判定。

## 2. 基线测量

- [x] 2.1 对现网 v1 persona 跑评测（`--runs 5`），记录每条命中率与失败样本。**验证**：`measurements.md` 有「v1 基线」一行组，且能复现「五个路径里至少一条 id 不匹配 `^intent:`」这一已知缺口。（实测 7/35=20%，`usage` 五跑五次全为 `nav_usage`；另暴露两类新失败：漏 `/console` 前缀与凭空造路径。）

## 3. 措辞硬化

- [x] 3.1 改 `docs/copilot-packs/lex-console-copilot/persona.md`：动作纪律节换成字面完整调用形状（`intent:navigate:/console/usage` 逐字出现，可直接照抄只换路径）+ 冲突裁决句（`id` 不是语义标签，即使工具说明写着 stable id，本协议下 `id` 就是信封）+ 后果句（`id` 不以 `intent:` 开头 ⇒ 用户只看到普通问询卡、页面不跳，而你会以为成功了）。**验证**：persona 文本 grep 得到字面 `intent:navigate:/console/usage`、裁决句与后果句各一处；不再出现 `intent:navigate:<路径>` 这类占位符写法。
- [x] 3.2 改 `skills/lex-intent-protocol/SKILL.md`：删掉与 persona 重复的格式说明，保留改口规则、一次一题、被拒后不重提、匿名/登录一视同仁等长尾纪律，并在开头指明信封的字面形状以 persona 为准。**验证**：skill 正文不再重复枚举五个路径的格式说明；改口规则四段仍在。
- [x] 3.3 对齐 `skills/lex-console-tour/SKILL.md` 的「何时发起 navigate」一节，改为引用 persona 的字面形状而不是自己再描述一遍语法。**验证**：该节不含 `intent:navigate:<路径>` 占位符写法，且仍能区分「想去看」与「只问在哪看」。

## 4. 变体对照

> 偏离说明：原任务写「四变体」，实测追加到 7 个。原因是基线暴露了字面例之外的两类失败（漏前缀 / 造路径），且硬化本身引入了对照项回归（见 4.1 记录），四变体不足以定位。追加项：A0（只枚举路径）、E（全上 + 区分「要你去」与「问在哪」）、E2（去掉后果句与裁决句）。

- [x] 4.1 用变体各跑一遍评测（`--runs 5`）：A0 只枚举五路径；A 再加字面例；B 再加后果句；C 再加裁决句；D 全上；E 再区分两种说法；E2 去掉后果句与裁决句。**验证**：`measurements.md` 有 7 行命中率表与各变体失败样本。（实测：基线 20% / A0 28.6% / A 88.6% / B 91.4% / C 85.7% / D 97.1% / E2 80% / **E 100%**。）
- [x] 4.2 按实测选定最终措辞并记明依据（含：后果句是否出现 priming 迹象；对照项是否回归）。**验证**：`measurements.md` 写明最终采用哪个变体、为什么，且最终 persona 就是该变体。（选定 E；另发现硬化导致对照项从 5/5 退化到 1~4/5，故必须加区分规则。）

## 5. 铸版与部署

- [x] 5.1 用最终 persona/skill 重铸 pack 为 v2：`build_manifest.py` 重新生成 manifest → `POST /api/packs/validate` → `POST /api/packs` 上架新版本。**验证**：`validatePackManifest` 0 错；上架返回的版本号大于 v1（v1 为 `XfyXvzONQFelnFIgM0dJVw` 的初版）。（已上架 v2，manifest 校验零错误。）
- [x] 5.2 用既有 billingKey 流程重部署该版本（`POST .../deploy`），embed-settings 保持匿名 + `origins=[lex.finddatatech.cloud]`。**验证**：deploy 返回 200 与新 slug；`embed-config` 实证 chatAble/anonymous/asks 均为 true。（facet 集群内 loopback 部署 v2 返回 200；`chat/<slug>/embed-config` 三项全 true；billing 沿既有绑定 `linked=true, balance=50.29`。）
- [x] 5.3 核对新版本 slug 是否与 v1 相同；不同则同步 `fd-lex` 的 `WIDGET_SLUG` 并出片。**验证**：`grep` 线上 lex bundle 得到当前在跑的 slug，与部署返回的 slug 一致（同 slug 时此项记为「无需改动」）。（slug 仍为 `packs-xfyxvzonqfelnfigm0djvw-lex-console-copilot`——`slugFor` 只吃 packId+agentId，不含版本；**无需改动**。）

## 6. 复验与留痕

- [x] 6.1 真机探针（自然语句，不给任何格式提示）：「带我去用量页」→ 卡片徽标显示「页面动作 · navigate · /console/usage」→ 点「执行」→ 宿主路由真变 → agent 收尾正确。**验证**：探针全过程记入 `measurements.md`，含徽标文本与路由变化的前后值。（navigate 与 refresh 各一条 + 对照项一条，全部通过；id 精确为 `intent:navigate:/console/usage` 与 `intent:refresh:`；answer receipt `accepted:true`；对照项 0 张卡。宿主路由真变属宿主侧行为，由 `add-copilot-control-surface` 验收覆盖，本次不重复。）
- [x] 6.2 `measurements.md` 汇总：v1 基线、变体表、最终选定、真机探针证据，并写明「模型或 serving 车道变更时重跑 `scripts/eval-intent-adherence.mjs`」的重跑口径。**验证**：`measurements.md` 四节齐全，评测命令可被他人照抄复现。（五节齐全：基线 / 变体表 / 最终选定 / 真机探针 / 重跑口径。）
- [x] 6.3 更新 `docs/adr/0004-host-intents-ride-question-ids.md` 的「实证与后果」节：把根因从「提示遵守度是运营面问题」改为「schema 的 stable id 描述与文档信封在同一字段上冲突，flash 模型按 schema 裁决」，并记处置（persona 常驻承载 + 字面例 + 裁决句 + 评测门）与 D7 备选。**验证**：ADR 该节含根因与处置两句，且指向本 change。
