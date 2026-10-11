# design — add-deployer-self-service

- **D1 通道**：`selfservice.js` 自建 facetForward（`x-facet-user`=base64url({email,groups}) + `x-facet-token`=FACET_INTERNAL_TOKEN）——三行形状与 paas facet-proxy 同源，不引跨仓依赖。env：`FACET_BASE_URL`、`FACET_INTERNAL_TOKEN`（wanxing-fleet secret 两键，GitOps）。
- **D2 我的 pack**：GET facet `/api/packs?includeUnlisted=1` → 按 authorEmail===identity.email 过滤 → 逐 pack 取详情（60s 进程内缓存可无：列表量小直接逐个 GET `/api/packs/:id`）拼 serving agent 概要（manifest.agents[].serving 存在性）。可部署性=含 serving 契约。
- **D3 部署转发**：归属校验（facet 详情 authorEmail 比对）→ POST `/api/packs/:id/versions/:v/deploy` body {billingKeys:{agentId:key}, notifyChannel?}；版本缺省=列表携带的 latest。错误透传（facet 的 error code/message 原样 4xx/5xx）。billing key 不落日志。
- **D4 分享卡**：slug=slugFor(agentPath)；URL=`${WEB_PUBLIC_BASE}#/chat/<slug>`（env `WANXING_WEB_BASE_URL`，缺省 wanxing 域）；chatability=复用 chat face 的判定输入（公网+未暂停+subsidyOpen||hostRemaining>0——facade 内直调 chatFace 的判定函数或同式重算）；额度=hostAllowanceGet+used。
- **D5 UI**：ConsoleView `deploy-panel`：列表行（名称/版本/可部署徽标/已部署 slug）→ 展开「部署」表单（agent 下拉（多 agent pack）、billing key password 输入、通知通道可空）→ 成功分享卡（URL 复制按钮+打开对话页+chatability 徽标+额度指引链接）；降级态横幅（通道未配置）。
- **D6 测试**：test-wanxing-selfservice.mjs——通道降级/作者过滤/foreign 404/billing key 缺失/facet 错误透传/分享卡拼装；UI 走沿现有面板先例。
