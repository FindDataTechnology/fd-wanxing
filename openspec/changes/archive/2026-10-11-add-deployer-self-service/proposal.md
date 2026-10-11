# add-deployer-self-service

## Why

M3 场景B 的具体故事（roadmap）：「部署 → 得到可分享的对话页 URL」。地基已齐——对话车道、chatability（public 部署即得）、部署管理面、按 email 的调用者面全部在役；唯一缺口是**部署者自助流**：今天从自己的 pack 到一个可分享的对话页，需要运营在壹座侧代操作（deploy 面在壹座设置里，萬星 console 只管理已部署的）。把这条路交给任何 creators 用户自己走完，场景B 才算开门。

## What Changes

- **facade→facet 转发身份通道**：facade 增 `FACET_BASE_URL`+`FACET_INTERNAL_TOKEN`（env，缺省=未配置显式降级），按既有 facet-forward 语义（`x-facet-user` base64url + `x-facet-token`）以 console 身份调 facet 公面。
- **我的 pack 列表**：`GET /api/wanxing/v1/console/my/packs`——经上述通道取 facet `includeUnlisted=1` 浏览并按 console 身份 email 过滤作者，返回「已发布 pack×版本×serving 契约 agent 概要」（是否可部署、公私、chat 链接可达性）。
- **自助部署**：`POST /api/wanxing/v1/console/my/packs/:id/deploy`——body 携 `{version?, agentId?, visibility? 无法改（pack 级属性）， billingKey, notifyChannel?}`；转发 facet deploy 端点（同身份）；billing key 为必填（serving 部署的硬要求——部署者自己的 sub2api 键，仅入部署引用不回显）。
- **分享卡**：`GET .../my/deployments/:slug/share`（或并入列表）——拼 `#/chat/<slug>` 完整 URL、chatability 状态（公网+未暂停+瀑布开着）、部署者额度余量与配置指引文案。
- **console UI**：ConsoleView 新「部署我的 agent」面板（data-testid deploy-panel）：我的 pack 列表 → 选中展开部署表单（版本/agent/计费键/通知通道）→ 成功后分享卡（URL 一键复制+对话页直达链接+chatability 徽标+额度指引）。

## Capabilities

### Modified Capabilities

- `wanxing-facade`: 新增部署者自助三端点（my packs / deploy / share 卡）与 facet 转发身份通道（ADDED requirements）。

## Impact

- 代码：`services/wanxing-facade/`（新 selfservice.js 模块挂 routes、env 两键）、`wanxing-web/ConsoleView.jsx`；测试沿 test-wanxing-console 先例。
- 配置：fd-infra-deploy 加 FACET_BASE_URL/FACET_INTERNAL_TOKEN（wanxing-fleet secret 两键）。
- 不做：visibility 切换（pack 级属性，改可见性=壹座侧 republish）、目录发现与 card 富化（②）、结算（④）。

## Non-goals

- 不动 facet 的发布/部署契约（facade 是纯转发消费者）。
- 不做匿名部署（部署者必须登录且其 pack 已在 facet 发布）。
