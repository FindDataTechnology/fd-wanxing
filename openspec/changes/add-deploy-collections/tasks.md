# Tasks — add-deploy-collections（M4③）

## 1. store

- [ ] 1.1 wanxing_collections 表（JSON entries 列）+ collectionsForOwner/Get/Insert/Update/
  Delete；suggestedConfig 形状常量（三键白名单）导出供 face 复用

## 2. facade

- [ ] 2.1 deployPackCore 抽取（deploy 路由内联逻辑函数化，路由行为不变）
- [ ] 2.2 collections CRUD + entries 整表替换（形状门：≤20/去重/三键白名单；foreign
  private 404）
- [ ] 2.3 detail 解析（browse/directoryAgents/快照三缓存 join；公开面剥 owner）
- [ ] 2.4 套装部署 POST /console/collections/:id/deploy（owner 或 public；逐条 verdict：
  deployed/skipped-in-service/refused/error；继续不阻断）
- [ ] 2.5 公开面 GET /collections/:id（仅 public）
- [ ] 2.6 测试：store CRUD/CRUD API 门与所有权/entries 形状门/套装部署编排（stub facet：
  own+foreign 绿地+在役跳过+拒收透传+suggestedConfig 载荷断言）/公开面 public-only

## 3. web

- [ ] 3.1 App 路由 +#/collections +#/bundle/:id；ConsoleView 入口链接
- [ ] 3.2 CollectionsView（列表/建/详情编辑/条目编辑器双源/suggestedConfig 输入/分享链接/
  BundleDeployDialog）
- [ ] 3.3 BundleView（公开页：解析条目+登录引导/登录后部署对话/not-found 态）
- [ ] 3.4 vite build 绿

## 4. 上线与实证

- [ ] 4.1 镜像出片+双滚（pod image 验证）
- [ ] 4.2 生产实证：建集合（目录源+我的 pack 混编+suggestedConfig）→ public 分享链接
  匿名可读 → 一键部署（绿地成功+在役跳过+逐条 verdict）→ 分享页部署对话
- [ ] 4.3 归档+伞文档 M4③ ✅+套装分享边界挂账拍板并入已定决策表+记忆
