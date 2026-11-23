# Tasks

## 1. registry 条目快照（`services/wanxing-facade/a2a.js`）

- [ ] 1.1 新增 `registryEntries()`：经注入的列表读函数分页读取（跟随 `has_next`，页数上限 100、时间预算与既有 bookkeeping 刷新同款），建立 `Map<agentPath, entry>`；TTL 60s + single-flight + 失败保留上一份。**验证**：`scripts/test-wanxing-facade.mjs` 新增用例——27 个部署的目录请求使上游只收到 1 次列表读；20 个并发请求仍只 1 次。
- [ ] 1.2 分页健壮性：`has_next` 为假、触顶页数、registry 重复返回同一页三种情况都要停止；触顶时 `console.warn` 一条含「已读条数/上报总数」的截断事实。**验证**：三条 stub 用例各断言停止行为与日志。
- [ ] 1.3 合成四个字段：`version`（台账 `dep.version` → 退回 `metadata.packVersion`）、`capabilities`（`streaming` → `{streaming:true}` / `{}`）、`provider`（`provider_organization` + `provider_url`，再过既有 `isPrivateProviderUrl` 脱敏）、`examples` 不提供。**验证**：stub 用例逐字段断言；`test-public-contract.mjs` 的 `catalogEntry`/`agentCard` 形状断言仍绿。
- [ ] 1.4 `entryFor(slug)` 改为查快照（保留其对外签名与返回形状）；**写路径 `setPaused` 仍走单条读**，加一条断言：暂停一次会且只会发出「GET 单条 + PUT」两次单条读写。**验证**：`test-wanxing-lifecycle-write`/`test-wanxing-console` 既有用例绿 + 新增计数断言。
- [ ] 1.5 `clusterUnits()` 纳入同 TTL 缓存。**验证**：同一分钟内两次目录请求，集群推导只发生一次（stub 计数断言）。

## 2. 消费面改接快照（`routes.js` / `console.js`）

- [ ] 2.1 在 `registerWanxingRoutes` 里把列表读函数接到 `doFetch`（同一 registry 凭据与超时），并把快照注入 a2a 面与控制台面。**验证**：`npm test` 全绿；`test-env-table.mjs` 仍绿（无新 env 名）。
- [ ] 2.2 `GET /api/wanxing/v1/status` 改用快照（今天走同一套逐条循环）。**验证**：stub 用例断言一次 `/status` 请求上游读为 0（快照新鲜时）；`test-stats-plane.mjs`/`test-public-contract.mjs` 既有断言绿。
- [ ] 2.3 `GET /api/wanxing/v1/console/deployments` 的逐条 enrichment 改查快照；`visibility`/`paused`/`name` 的来源不变。**验证**：`test-wanxing-console.mjs` 绿 + 新增「N 个部署只 1 次上游读」断言。

## 3. 详情页改读卡片面（`wanxing-web`）

- [ ] 3.1 `AgentDetailView.jsx` 取数改为 `GET /api/wanxing/v1/a2a/<slug>/.well-known/agent-card.json`；删除为定位单条而做的 `page_size=200` 目录读。状态徽标仍取目录行（一次轻量目录读，或用传入的 entry）。**验证**：`wanxing-web/test/views.test.jsx` 新增用例——详情渲染发起 1 次卡片读且不发起 `page_size=200` 请求；技能带 `description` 渲染。
- [ ] 3.2 未知 slug 与卡片 404 的呈现沿用既有 `AGENT_NOT_FOUND` 文案。**验证**：`views.test.jsx` 用例断言 404 时渲染「未找到」而非空页。

## 4. 验收（真机）

- [ ] 4.1 出片并滚 facade / web 镜像 tag（`fd-infra-deploy`），确认 rollout 完成。**验证**：两个 Deployment 的镜像 digest 为新值且 pod `Ready`。
- [ ] 4.2 并发验收：同一分钟内 20 并发 `GET /api/wanxing/v1/agents`，全部 < 1s（对照今天 49.9s）；门面日志显示上游只收到一次列表读。**验证**：命令输出 + 日志。
- [ ] 4.3 字段验收：目录行与卡片面的 `version` 相等，且等于部署台账版本（抽 3 个 agent）；暂停一个 agent 后 60 秒内目录反映。**验证**：`curl` 对比 + 真机操作。
- [ ] 4.4 首屏验收：落地页 `/status` + `/agents` 并发打 10 次不再放大；页面首屏 6 张卡正常渲染。**验证**：计时 + 截图。

## Workflow follow-up

- 归档后用 `memory_write_page` 记录：目录扇出的根因（逐 slug 单条读 + 无 single-flight）、列表读面的四个字段缺口与合成来源、写路径必须保留单条读。
- registry 侧 `version` 写陈旧的原因排查，另立专项（不在本 change 范围）。
- 目录内容清理（probe/验收残留/`security-pending` 转 private）不属于本 change 的代码范围，按 `docs/acceptance-catalog-hygiene.md` 走数据动作。
