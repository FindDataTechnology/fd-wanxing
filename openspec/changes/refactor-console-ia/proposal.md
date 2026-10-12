## Why

M4④ 驾驶舱的前置半边（伞文档 §M4④：「前置 console IA 重构……R4 教训 = 先骨架后可视化」）：
ConsoleView 已 1442 行、七块垂直堆叠（机群总览/时间线/管理部署/我的套餐/部署面板/我的任务/
套餐管理），向导与集合等子组件已经自Contained——继续在上面堆可视化就是在旧骨架上加楼层。
重构为「我的舰队 / 我的任务 / 运维面」三标签，为 ④b 可视化清地基。

## What Changes

- **纯重构，零行为/接口变化**：所有 testid、端点调用、面板行为原样搬迁。
- ConsoleView 瘦身为壳：登录门 + 三标签切换 + focusSlug 路由（保留 `#/console/<slug>`
  深链=舰队标签开配置面板；新增保留字 `#/console/missions`、`#/console/ops` 切标签——
  slug 命名空间 packs-* 无碰撞）。
- 拆四个文件：`console/FleetView.jsx`（管理·部署+四面板+我的套餐+部署面板[向导+收益]）、
  `console/MissionsView.jsx`（我的任务）、`console/OpsView.jsx`（机群总览+时间线+套餐
  管理 ops）、`console/DeployWizard.jsx`+`console/shared.jsx`（工具）。
- **随组件化而来的自然改进**：各标签数据按需加载（board 30s 轮询只在运维标签开着时跑）。

## Impact

- 仅 wanxing-web；facade 零改动。测试=build 绿+浏览器三标签全走查（全部 testid 在场）+
  深链回归（slug→配置面板/missions/ops）。
- specs：wanxing-web 的 console 视图需求增补三标签场景。
