## Why

万星控制台两个用户体验缺陷被实测抓到，根因均已确定：

一是**消耗视图两张表格文字错位**。表格「口径」列缺少截断约束，撑破卡片边界，导致表头与表身列不对齐（实测 1280 视口下 by-agent 表溢出 12px，768 下溢出 140px）。

二是**点击登录后跳黑屏**。用户确认黑屏落在万星自己的 `#/console`（非 Logto 登录页）。实测复现：跳转链路本身正常（303 → Logto sign-in → 登录页渲染正常），但**一旦带上 token 进入 `#/console`，整棵 React 树崩溃、root 子元素归零**——深色模式下即一整屏黑。崩溃点是 `FleetView.jsx` 里对后端响应深层字段的无保护读取（`stmt.usage.planMinutes`、`earn.totals.settledUsd`）：任一字段缺失即抛 `TypeError`，React 卸载整棵树，页面变全黑且无任何错误提示。这不是"观感不好"，是未捕获渲染异常。

## What Changes

- **控制台渲染崩溃兜底**：`FleetView.jsx` 对后端响应深层字段的读取改为可选链 + 默认值，字段缺失时该面板显示占位/错误文案，而不是让整棵树崩掉。
- **控制台错误边界**：登录后的控制台加一层 React 错误边界，任何面板渲染异常都被截获并显示可见错误，不再退化成空白页。
- 消耗视图（`StatsView.jsx`）两张表格的「口径」列补上截断约束，使其与相邻的 `agent`/`pack` 列一致——长内容压在列内，不再撑宽表格。
- 两张表格外层补横向滚动兜底，窄屏（≤768px）下表格不再溢出卡片。
- 消耗视图新增一条渲染契约：表格内容溢出时不得改变列宽，表头与表身必须始终对齐。

**非目标**：不改统计口径语义（fleet/sub2api/local 三口径分列不变），不动统计 API 契约，不重排消耗视图的信息架构；不改登录跳转链路（实测正常）。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `wanxing-web`：新增消耗视图表格的渲染约束——表格必须容纳在自己的卡片内，列宽不随内容长度漂移，表头与表身列对齐。

## Impact

- `wanxing-web/src/views/console/FleetView.jsx`：套餐结算（:513）、收益（:538-539）、调用记录（:438）、允许额度（:473）等处的深层字段读取改可选链；控制台加错误边界。
- `wanxing-web/src/views/console/StatsView.jsx`：第 145 行、第 168 行两处「口径」单元格补 `truncate` + 最大宽度；两张 `<table>` 外包一层 `overflow-x-auto`（与 `DocsView.jsx:51` 现有写法一致）。
- `wanxing-web` 出片：web 镜像按既有 `Dockerfile.web` / 通用池流程重新出片并滚产。
- 无 API、无数据库、无跨仓契约变更。
