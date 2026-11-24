# Tasks

## 1. registry 条目快照（`services/wanxing-facade/a2a.js`）

- [x] 1.1 新增 `registryEntries()`：经注入的列表读函数分页读取（跟随 `has_next`，页数上限 100、时间预算与既有 bookkeeping 刷新同款），建立 `Map<agentPath, entry>`；TTL 60s + single-flight + 失败保留上一份。**验证**：`scripts/test-wanxing-facade.mjs` 新增用例——27 个部署的目录请求使上游只收到 1 次列表读；20 个并发请求仍只 1 次。
- [x] 1.2 分页健壮性：`has_next` 为假、触顶页数、registry 重复返回同一页三种情况都要停止；触顶时 `console.warn` 一条含「已读条数/上报总数」的截断事实。**验证**：三条 stub 用例各断言停止行为与日志。
- [x] 1.3 合成四个字段：`version`（台账 `dep.version` → 退回 `metadata.packVersion`）、`capabilities`（`streaming` → `{streaming:true}` / `{}`）、`provider`（`provider_organization` + `provider_url`，再过既有 `isPrivateProviderUrl` 脱敏）、`examples` 不提供。**验证**：stub 用例逐字段断言；`test-public-contract.mjs` 的 `catalogEntry`/`agentCard` 形状断言仍绿。
- [x] 1.4 `entryFor(slug)` 改为查快照（保留其对外签名与返回形状）；**写路径 `setPaused` 仍走单条读**，加一条断言：暂停一次会且只会发出「GET 单条 + PUT」两次单条读写。**验证**：`test-wanxing-lifecycle-write`/`test-wanxing-console` 既有用例绿 + 新增计数断言。
- [x] 1.5 `clusterUnits()` 纳入同 TTL 缓存。**验证**：同一分钟内两次目录请求，集群推导只发生一次（stub 计数断言）。

## 2. 消费面改接快照（`routes.js` / `console.js`）

- [x] 2.1 在 `registerWanxingRoutes` 里把列表读函数接到 `doFetch`（同一 registry 凭据与超时），并把快照注入 a2a 面与控制台面。**验证**：`npm test` 全绿；`test-env-table.mjs` 仍绿（无新 env 名）。
- [x] 2.2 `GET /api/wanxing/v1/status` 改用快照（今天走同一套逐条循环）。**验证**：stub 用例断言一次 `/status` 请求上游读为 0（快照新鲜时）；`test-stats-plane.mjs`/`test-public-contract.mjs` 既有断言绿。
- [x] 2.3 `GET /api/wanxing/v1/console/deployments` 的逐条 enrichment 改查快照；`visibility`/`paused`/`name` 的来源不变。**验证**：`test-wanxing-console.mjs` 绿 + 新增「N 个部署只 1 次上游读」断言。

## 3. 详情页改读卡片面（`wanxing-web`）

- [x] 3.1 `AgentDetailView.jsx` 取数改为 `GET /api/wanxing/v1/a2a/<slug>/.well-known/agent-card.json`；删除为定位单条而做的 `page_size=200` 目录读。状态徽标仍取目录行（一次轻量目录读，或用传入的 entry）。**验证**：`wanxing-web/test/views.test.jsx` 新增用例——详情渲染发起 1 次卡片读且不发起 `page_size=200` 请求；技能带 `description` 渲染。
- [x] 3.2 未知 slug 与卡片 404 的呈现沿用既有 `AGENT_NOT_FOUND` 文案。**验证**：`views.test.jsx` 用例断言 404 时渲染「未找到」而非空页。

## 4. 验收（真机）

- [x] 4.1 出片并滚 facade / web 镜像 tag（`fd-infra-deploy`），确认 rollout 完成。**验证**：两个 Deployment 的镜像 digest 为新值且 pod `Ready`。
- [x] 4.2 并发验收：同一分钟内 20 并发 `GET /api/wanxing/v1/agents`，全部 < 1s（对照今天 49.9s）；门面日志显示上游只收到一次列表读。**验证**：命令输出 + 日志。
- [x] 4.3 字段验收：目录行与卡片面的 `version` 相等，且等于部署台账版本（抽 3 个 agent）；暂停一个 agent 后 60 秒内目录反映。**验证**：`curl` 对比 + 真机操作。
- [x] 4.4 首屏验收：落地页 `/status` + `/agents` 并发打 10 次不再放大；页面首屏 6 张卡正常渲染。**验证**：计时 + 截图。

## Workflow follow-up

- 归档后用 `memory_write_page` 记录：目录扇出的根因（逐 slug 单条读 + 无 single-flight）、列表读面的四个字段缺口与合成来源、写路径必须保留单条读。
- registry 侧 `version` 写陈旧的原因排查，另立专项（不在本 change 范围）。
- 目录内容清理（probe/验收残留/`security-pending` 转 private）不属于本 change 的代码范围，按 `docs/acceptance-catalog-hygiene.md` 走数据动作。

## 验收记录（2026-11-24，真机）

在库内/公网两层分别实测，每一层都修到「并发不再放大」为止：

| 层 | 修前 | 修后 |
|---|---|---|
| 单请求上游读 | 27 次单条串行 3485ms | 1 次列表 198ms（TTL 内 0 次） |
| 公网 20 并发 | 49.9s | 0.71–0.81s（彼此一致 = 共享同一快照） |
| pod 内 16 并发（TTL 到点） | 6406ms | 681ms（browse 加 single-flight 后 480ms） |
| pod 内目录中位数 | 205ms | 5ms（`poke()` 不再每 15s 阻塞） |
| 详情页取数 | 1 次 `page_size=200` 全目录枚举 | 1 次 `?slug=` 单行 + 1 次卡片（浏览器请求轨迹实证） |

字段验收：目录行与卡片面的 `version` 逐条相等（27/27），且取部署台账真值（探针 Agent v1→v10、寻数分身 v1→v6）；带描述的 skills 只在卡片面出现，详情页正确采用。

## 追加范围（2026-11-24，用户「你来主导」后）

处置目录内容时发现的两个真缺陷，一并修掉并上产：

- [x] 5.1 目录把 registry 已禁用的条目照常列出、卡片 200、`chatAble:true`。修：`agentState` 回报 `disabled`（与 `paused` 两件事），目录 / facets / `/status` 规模 / 卡片面一律跳过，API 车道 `admit` 报 `AGENT_DISABLED`，对话车道 `chatable` 为假。**验证**：线上目录 27→25、卡片 404、`chatAble:false`。
- [x] 5.2 禁用时 `/chat/:slug/status` 给了 `chatAble:false` 但 `reason:null`，界面会落到「主人未配置额度」那张错误说法。修：补 `agent_disabled` 与对应中文文案。

## 待决（不在本 change 范围，需人拍板）

- registry 里三个 agent 的节奏声明是「下载并执行外部主机的 shell 脚本」
  （`47.236.224.219:18080/read_channel.sh`、`oc-alive2`、`webhook.site/beacon`）。
  **已全部 disable**（探针 Agent / 健康巡检 Agent / 巡检），节奏随之停跑（实测最后自回合 01:42，17 分钟无新增）。
- 更根本的一条：这些 agent 的执行环境里挂着**平台共用的 LLM key**（每个 agent home 的
  `.credentials.yaml` 都有同一把），所以「能跑外部脚本」等于「外部脚本能读到平台 key」。
  这把 key 出现在 6+ 个 agent home 里，不是探针专属泄漏——轮换它会同时影响所有在役 agent，
  属跨仓/跨服务的运维决定，没有在此代做。
