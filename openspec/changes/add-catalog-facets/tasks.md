# Tasks — add-catalog-facets（M4②）

## 1. facade：facets+策展+热度

- [ ] 1.1 store：`usageTurnsByAgent(sinceMs)`（GROUP BY agent_slug 一次查）
- [ ] 1.2 a2a face：curationCache（browse 60s 缓存，缺行诚实降级）；catalog 条目带
  category/featured/turns7d；`q/category/featured` 过滤（分页前）+ `facets=1` 汇总块；
  无参=旧形状字节级不变
- [ ] 1.3 测试：过滤次序（过滤前分页）/汇总基于未过滤集/策展缺行降级/turns7d 口径/
  无参回归

## 2. facade：目录源+绿地部署

- [ ] 2.1 selfservice：`GET /console/catalog/packs`（browse+detail join+在役状态，
  detail 60s 缓存；deployableAgents 映射抽函数与 my/packs 共用）
- [ ] 2.2 selfservice deploy 所有权分支：foreign+public+无在役→放行转发附 creators 组；
  foreign+在役→400 指名；own/private 路径不变
- [ ] 2.3 测试：目录源形状/绿地放行（转发组断言）/在役拒收/own 回归/private 404 回归

## 3. web

- [ ] 3.1 CatalogView：服务端 q（防抖）+category chips（facets 计数）+精选前置组+
  category/turns7d 徽标；空过滤态≠错误态
- [ ] 3.2 DeployWizard step 1：源切换 tab+目录行（category/★/在役徽标，在役禁选）
- [ ] 3.3 vite build 绿

## 4. 上线与实证

- [ ] 4.1 镜像出片+facade/web 双滚（pod image 验证）
- [ ] 4.2 生产实证：目录页 chips/精选/搜索服务端命中；绿地 foreign 部署全流程
  （目录选包→向导→上线进目录带 category/turns7d）；在役拒收实证
- [ ] 4.3 归档+伞文档 M4② ✅+热度口径挂账并入已定决策表
