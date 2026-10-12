# Tasks — refactor-console-ia（M4④ 前置）

- [x] 1.1 拆 console/{shared,DeployWizard,FleetView,MissionsView,OpsView}.jsx；ConsoleView
  瘦壳（登录门+三标签+focusSlug 保留字路由）
- [x] 1.2 vite build 绿；全部 testid 原位
- [x] 2.1 浏览器走查：三标签内容齐（board/wizard/missions/plans 等 testid 在场）；
  深链 #/console/<slug> 开配置面板、#/console/missions、#/console/ops 切标签
- [x] 3.1 部署 web 单滚+生产走查
- [x] 3.2 归档+路线图 M4④ 前置 ✅（IA 重构半边）+记忆

## 验收实证（2026-10-12 生产）

- build 绿（修复两处搬运伤：shared.jsx 漏写、DeployWizard 缺 export——build 门抓取后
  amend）；testid 集合 diff 零丢失（仅壳新增 console-shell/console-tab-*）。
- 生产走查（sha-58a1f96 web 双 pod）：三标签内容齐且互斥（舰队=管理+套餐+部署面板+
  收益+向导+集合链接 10 行部署；任务=missions；运维=board+时间线+套餐管理）；
  深链 #/console/missions、#/console/ops 切标签；#/console/<slug> 落舰队标签开
  配置面板（壹座「去配置」契约不变）。
