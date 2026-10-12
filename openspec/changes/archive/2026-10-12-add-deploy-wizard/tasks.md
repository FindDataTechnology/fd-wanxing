# Tasks — add-deploy-wizard（M4①）

## 1. facade 载荷扩展

- [x] 1.1 selfservice deploy 端点：接受 agents/models/budgets/rhythms；billingKeys/notifyChannel
  按选中集映射；最小形状门（纯对象/字符串数组）+ facet 透传不动；limit 4kb→16kb
- [x] 1.2 my/packs 富化：deployableAgents 项带 modelWhitelist（无声明不伪造）
- [x] 1.3 test-wanxing-selfservice.mjs：子集映射断言（billingKeys 只映射选中）、透传断言
  （agents/models 原样到达 facet stub）、my/packs whitelist 断言、缺省全量回归

## 2. console 向导

- [x] 2.1 DeployWizard 子组件：step 状态机（选包/勾 agent/配置/计费通知/done），草稿跨步保持
- [x] 2.2 配置步：per-agent model（whitelist 提示）/budget/rhythm 预设+自定义 JSON；空=缺席
  （不传 null）
- [x] 2.3 计费步：计费键（面板指引链接）+通知通道+多选中单键提示；结构化拒绝 verbatim 展示
  且不丢配置
- [x] 2.4 结果步：分享卡+host-allowance 内联设置+allowlist caller 添加；收尾失败 inline 不回滚
- [x] 2.5 deploy-panel 旧表单移除（向导取代）； earnings 区保留原位

## 3. 测试与构建

- [x] 3.1 facade 全套件绿（node --test scripts/test-*.mjs）
- [x] 3.2 wanxing-web build 绿（vite build）

## 4. 上线与实证

- [x] 4.1 镜像出片（law-ai-official 线）+ facade/web 双滚
- [x] 4.2 生产实证：真 pack 子集部署（勾 1/N agent）→ deployed 只含选中 → 结果步额度/allowlist
  收尾可用 → 分享卡 URL 可对话
- [x] 4.3 归档 + 伞文档 M4① ✅

## 验收实证（2026-10-12 生产）

- 1.1-1.3：selfservice 9/9（子集映射/透传/whitelist/缺省回归）。
- 2.1-2.5：vite build 绿；生产浏览器全流程——选包→勾 wx-alpha（弃 wx-beta）→
  配置（模型车道拒收一轮：错误 verbatim+配置保持）→ 计费键提交→
  `已部署 v2` 仅 wx-alpha（facet 记账 1 行；registry 描述符
  effective_model=inclusionai/ling-3.1-flash / budget=10 / rhythm=1h）。
- 2.4 结果步收尾：host-allowance 30 分钟已保存+分享卡实时刷新（余 30/30）；
  allowlist caller aloadtree@gmail.com 落账（GET callers 回读 userId=2）；
  无 sub2api 账号邮箱被诚实拒（inline 显示、部署不受扰）。
- 3.1-3.2：facade 全套件 121/121；镜像 sha-b25f05a（law-ai-official 线）。
- 4.2：生产实证平台补贴瀑布显示可对话；验收 agent 部署后已暂停（资源好公民）。
