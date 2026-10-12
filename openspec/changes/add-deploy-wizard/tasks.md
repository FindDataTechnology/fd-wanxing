# Tasks — add-deploy-wizard（M4①）

## 1. facade 载荷扩展

- [ ] 1.1 selfservice deploy 端点：接受 agents/models/budgets/rhythms；billingKeys/notifyChannel
  按选中集映射；最小形状门（纯对象/字符串数组）+ facet 透传不动；limit 4kb→16kb
- [ ] 1.2 my/packs 富化：deployableAgents 项带 modelWhitelist（无声明不伪造）
- [ ] 1.3 test-wanxing-selfservice.mjs：子集映射断言（billingKeys 只映射选中）、透传断言
  （agents/models 原样到达 facet stub）、my/packs whitelist 断言、缺省全量回归

## 2. console 向导

- [ ] 2.1 DeployWizard 子组件：step 状态机（选包/勾 agent/配置/计费通知/done），草稿跨步保持
- [ ] 2.2 配置步：per-agent model（whitelist 提示）/budget/rhythm 预设+自定义 JSON；空=缺席
  （不传 null）
- [ ] 2.3 计费步：计费键（面板指引链接）+通知通道+多选中单键提示；结构化拒绝 verbatim 展示
  且不丢配置
- [ ] 2.4 结果步：分享卡+host-allowance 内联设置+allowlist caller 添加；收尾失败 inline 不回滚
- [ ] 2.5 deploy-panel 旧表单移除（向导取代）； earnings 区保留原位

## 3. 测试与构建

- [ ] 3.1 facade 全套件绿（node --test scripts/test-*.mjs）
- [ ] 3.2 wanxing-web build 绿（vite build）

## 4. 上线与实证

- [ ] 4.1 镜像出片（law-ai-official 线）+ facade/web 双滚
- [ ] 4.2 生产实证：真 pack 子集部署（勾 1/N agent）→ deployed 只含选中 → 结果步额度/allowlist
  收尾可用 → 分享卡 URL 可对话
- [ ] 4.3 归档 + 伞文档 M4① ✅
