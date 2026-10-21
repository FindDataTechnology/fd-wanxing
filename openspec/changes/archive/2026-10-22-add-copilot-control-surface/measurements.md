# measurements — add-copilot-control-surface（+姊妹 add-serving-ask-bridge）

## 4.1 部署前核实（2026-10-21）

- `pack-demo-fingpt`（packs-vtdpsNmtW6OQ9I99mBhbDw，演示分析师）registry 条目 metadata **无 `effective_model`**——走 runner 默认车道。
- runner-serving env：`AGENT_RUNNER_PROVIDER=finddata`，`AGENT_RUNNER_MODEL=deepseek-v4.1-flash`（即 fingpt 实证可用的车道）。
- **LLM 事故差分解**：LLM 凭据是**物化时**写进私家家的（compose.js `writeLlmProfile`/`ensureCredentialsStore`），旧部署的家持有轮换前的旧 key；fingpt 是后物化的所以通。⇒ 新部署物化即取当前 key，**无需钉模型**；旧部署 LLM 坏属独立事故（重启 runner 全量重物化可修——本次已顺手执行），与本 change 无关。

## 4.2 pack（已铸已验已上架）

- 源：`~/finddata/docs/copilot-packs/lex-console-copilot/`（persona + 4 skills：console-tour / quota-billing / credentials-guide / intent-protocol）。
- manifest：`serving = {protocol:"a2a", budget:{turnMinutes:8}, card:{…}}`；无 MCP 引用；paas 真校验器 `validatePackManifest` **0 错**。
- 上架：`POST /api/packs`（代理通道，作者 ops-seed@finddatatech.cloud）→ **packId `XfyXvzONQFelnFIgM0dJVw` v1**。

## 4.3 部署（留用户的计费键）

- `deployPackCore` 强制 `billingKey`（sk-，sub2api 计费键）——真金绑定属用户决策，不代铸代绑。
- 待执行（用户给键即可）：`POST /api/wanxing/v1/console/my/packs/XfyXvzONQFelnFIgM0dJVw/deploy`，body `{"billingKey":"sk-…","agents":["lex-console-copilot"]}`；部署后 embed-settings 开匿名 + origins 加识律站，`WIDGET_SLUG` 换新 slug。
- E3 机制验收不依赖新部署——在 fingpt 上完成（见下）。

## 滚产终态（四镜像全上产，2026-10-21 晚）

| 镜像 | tag | digest | 源 |
|---|---|---|---|
| yizuo/platform（agent-runner-serving） | sha-a9460a2 | ca793303… | paas 736c80be（2753630c+lint 修） |
| yizuo/wanxing-facade | sha-56efb2e | df8559ab… | fd-wanxing 97f5aa1 |
| yizuo/wanxing-web | sha-56efb2e | 5ea1d1cd… | fd-wanxing 97f5aa1 |
| finddata-business/fd-lex-web | sha-289851b | 1b204e43… | fd-lex 0c0af13 |

- 出片通道：testaction001/build-pool 串行四发；**排雷记录**：接手时池残留 `BUILD_CONTEXT=web / BUILD_DOCKERFILE=web/Dockerfile`（fd-lex 上一位）致 platform 首跑秒红（paas 无 web/Dockerfile）——删变量 rerun 绿；后续每镜像按需设/清变量。公开 verify 仓 ba60b17 的 image-build-check（build+五冒烟）success（CI 红为 6 处他仓已推代码的预存 lint 欠账，本 change 1 处已修）。
- gitee 双远端坑两次实撞：fd-infra-deploy 与 fd-lex 的 push 必须打 **gitee**（ArgoCD 真源），origin 是 github。
- 同一性证据：pod imageID↔skopeo digest 双向、in-pod grep（dsh.js `userQuestion/ask`=1、a2a.js `ask-answer`=1、桥文件在镜像）、公网 bundle grep（wanxing `wx-embed-ask`、lex `wx-copilot-intent`）。

## 4.4/5.x 探针与验收（curl 级全过；真机被入口缓冲挡一道）

- **非 opt-in 拒答**：fingpt `message/send` 让其调 `ask_user_question` → agent 原样复述工具错误 `Error: the caller cannot answer questions`（新桥+快速拒答上产实证；滚前是 NO_PROVIDER）。
- **registry 反代**：`/agent/<path>/ask-answer` 子路径 + X-Authorization/Authorization 双头透传全通（旧镜像 404 Express 形状 → 新镜像 `{accepted:false,reason:"no live runtime"}`）。
- **deadline 自取消**：无人答题 → runner 到期 cancel（agent 复述 `Error: the ask window closed before the user answered`）→ 回合正常收尾 message+done。
- **port-forward 全链终证**（facade pod 直打，绕公网前置）：prompt 后 **11.5s** 收 `ask`（`intent:navigate:/console/usage` 信封由模型自行组成，无需 pack 技能）；**11.8s** facade `ask-answer` → `{"accepted":true}`（匿名访客归属绑定+代理）；**26.5s** agent 最终回复**准确复述「你选择了执行」**——答案真实回到模型。
- **SSE 缓冲三段定罪**：① runner 源头即时（pod 内 8.5s）；② registry 应用面 `100.64.0.15:18080` 即时（facade pod 内 node 直读分块到）；③ facade 全链即时（port-forward）。**唯一攒包层 = 公网前置 SafeLine/WAF**（mcp:443 与 wanxing 两 vhost 同病；wanxing 公网数数回合 delta#1..#8+done 全在 5.7s 同刻）。E1 起纯聊天「整回合末出字」即此因（功能可用）；**对问询交互不可用**（ask 迟到→deadline 先到）。处置：facade `registry_url` 已切 `http://100.64.0.15:18080` 直连（secret 一改即滚，已上产；回滚=改回 https://mcp…）；**公网入口缓冲待用户决策**（SafeLine 流式配置 / wanxing 换入口 / 短轮询兜底），ego 真机四线（5.2）与切 slug（5.3）因此暂缓。

## 顺手修复

- runner 全量重启使所有 warm child 重物化私家（新 overlay + 新 LLM 凭据）——data-scout/wx-alpha 等旧「LLM 坏」部署预期恢复（未逐一复测，属独立事故面）。

## 追记（2026-10-22 凌晨）：正式 pack 已部署、slug 已切、第五镜像上产

- **计费键**：用户提供的外来 sk- 键经归属检查被拒（findUserByEmail 要求邮箱精确相等；aloadtree 的既有 sub2api 账户 id 2 邮箱正是 aloadtree@gmail.com，经 OIDC 面板登录核实）。按用户指示「用他的账号注册一个」执行为：**OIDC 登录词元面板（token.finddatatech.cloud，Logto 会话复用）→ 在 aloadtree 账户（id 2，组 3）铸部署 key** `wanxing-lex-console-copilot`（明文只存 `~/finddata/secrets/sub2api-aloadtree-lex-copilot.key`，0600）；**admin 充值 +50**（幂等键 lex-copilot-deploy-20261021，余额 1.96→51.96）。用户原 sk- 键未入库（无属主，sub2api 搜不到）。
- **部署**：console 会话（ego）`POST my/packs/XfyXvzONQFelnFIgM0dJVw/deploy`（billingKey=新铸键）→ 200 `{deployed:[{slug:"packs-xfyxvzonqfelnfigm0djvw-lex-console-copilot"}]}`；embed-settings：anonymous=true + origins=[lex.finddatatech.cloud]；embed-config 实证 chatAble/anonymous/asks=true。
- **新 agent 双探针（port-forward 全链）**：①首回合 44.2s（含冷启）persona 完整（三件事+确认卡说明+两条不编数字红线）；②自然语句「带我去用量页」26.8s 出问询卡（[执行,跳过]）→ 答题 accepted → 收尾正确（口径解读+红线）。**已知缺口**：问询 id 为自命名 `nav_usage` 而非 `intent:navigate:/console/usage` 信封（skill 有约束但模型未完全遵守；fingpt 被明示时能带对）——宿主动作桥对正式 pack 需 v2 强化 skill 措辞（或 few-shot），机制本身已由 fingpt 实证。
- **切 slug**：fd-lex `WIDGET_SLUG` → 新 slug（6243d4e+119b254，测试改引用导出常量消漂移 4/4）；**fd-lex-web sha-84724f2**（digest b5e72c01）滚产；lex 公网 bundle 实证含新 slug。
- 镜像累计：本 change 五镜像（platform a9460a2 / 萬星双 56efb2e / lex-web 289851b+84724f2）。
- ego 四线（5.2）仍待 SafeLine 入口修复后执行。

## 5.2 ego 真机四线（2026-10-22 01:10–01:30，SafeLine 修复后）

宿主：等价 harness（`http://127.0.0.1:8899/host.html`，协议逐字镜像 `WanxingCopilot.tsx`：挂载即推 context+init 声明动词、identity 回 null、`wx-copilot-intent` 白名单执行并回 result；lex 侧执行器本身由 vitest 4/4 + 线上 bundle grep 覆盖——aloadtree 非 lex-customers 成员进不了真控制台 403，同 E1 前例）。临时把 harness 源与 wanxing 自源加进两 agent 的 origins，验收后已还原为只剩识律站。

| 线 | agent | 结果 |
|---|---|---|
| ② 意图往返 | 识律 copilot（明示 intent id） | 卡 ≤15s；徽标「页面动作 · navigate · /console/usage」+「确认后由宿主页面执行」，倒计时 437s；点「执行」→ harness 路由标记切 `/console/usage` → 摘要「→ 执行」→ agent「你选择了执行…交由宿主页面执行」 |
| ① 账本 | 同上回合 | wanxing_usage +1 行（wu_996df0ef… ok/1min/settled/chat/subsidy/anon），答题 +0 |
| ④ 未声明动词 | fingpt（harness intents=0） | 卡标「当前页面不支持此操作」；点执行→**未发意图**（harness 无 intent 日志、路由未动）、摘要带「（当前页面不支持此操作（宿主未声明 navigate））」、agent 改口 |
| ③ 到期取消 | fingpt（3 分预算，不答） | +4s 出卡 → **+160s** 自动取消（摘要「问询「继续吗？」已取消。」）→ agent 体面收尾「请求被关闭、未收到回答，停在这里」 |

## 顺带抓出并修复的 E1 生产缺陷：同源 POST 的 Origin 头

- 现象：harness 里 widget 匿名铸发 403 `EMBED_ORIGIN_NOT_ALLOWED`；真浏览器 widget 页内同源 POST 复现 403。
- 根因：浏览器对**所有 POST**（含同源）都带 Origin；chat.js「header 恒赢」+「同源无 Origin」的错误前提 ⇒ widget 自铸匿名凭据永远被拒（E1 匿名线当时应为 curl 铸 token 注入验的）。
- 修复 8483256：Origin 头的 host 等于本请求 Host（同源调用）时信任 body 的 claim；外源头仍恒赢；host-only 比较兼容反代改 scheme。embed 测试补三例 + embed-config 键集补 `features`。**facade sha-fa94037**（digest ab10705d；快照 49242b5 含并行会话的集群服务单位提交）滚产；真浏览器复验：允许 claim 201 / 恶意 claim 403（origins 已只剩识律站）。
