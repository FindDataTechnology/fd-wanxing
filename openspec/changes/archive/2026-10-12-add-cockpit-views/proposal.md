## Why

M4④b 驾驶舱可视化收官（伞文档 §M4④）：IA 骨架已就位（refactor-console-ia），现在把
「看得清」落到卡片与进度上——体验标准：**用户不读手册能答「在干活吗/离目标多远/花了多少钱」**。
数据源全在产（usage 台账/host allowance/missions 状态机），缺的只是一次拉齐的聚合端点与呈现。

## What Changes

- **facade**：新端点 `GET /console/fleet/summary`（验证身份门，store-only 零外部调用）：
  按slug 一次聚合 usage 台账（turns7d / minutes30d / usd30d——单 SQL 条件聚合）+ 全部
  host allowance（limit/remaining）——客户端与既有部署列表 join 成卡片。
- **web FleetView**：部署表升级为**部署卡片**——每卡：健康（运行中/已暂停+可见性）/
  最近回合（近 7 天 N 回合）/成本水位（30 天分钟+$）/额度余量（余 N/M 分钟或未设置）+
  对话链接+既有管理动作（配置/记录/额度/允许清单/暂停收进卡片行）。紧凑表格移入卡片
  的「详情」折叠（slug/agentPath 仍可查）。
- **web MissionsView**：进度可视化——列表行加花费水位条（spent/cap）；详情加整体进度条
  （done/total 步骤）+成本水位条+窗口剩余；报告保留。纯前端（数据已全在 missions 响应）。

## Impact

- facade：store 一个聚合方法+一个路由；web 两视图改造。测试：summary 形状/门/聚合口径
  （单测）+build 绿+浏览器卡片/进度走查。
- specs：wanxing-facade 新增 fleet summary 需求；wanxing-web 新增驾驶舱卡片+任务进度需求。
