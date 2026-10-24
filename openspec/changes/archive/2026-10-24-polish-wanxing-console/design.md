# Design — polish-wanxing-console

## Context

wanxing-web 是 React 19 + Vite + Tailwind v4 的无路由库 hash 路由 SPA（App.jsx 静态 import 全部视图，单 bundle 408KB）。FleetView.jsx 40.7K：部署卡片一排操作按钮（暂停恢复/配置/记录/记忆/额度/嵌入/允许清单），七个面板（cfg/callers/memory/usage/allowance/embedS/earn）以 `{x && (<div className="rounded-xl border …">)` 顺序堆叠在卡片列表下方——开多个面板整页越拉越长，且面板与所属卡片的从属关系全靠 slug 标题。StatsView 每日序列是手搓 div 横条（`stats-daily`），数据来自既有接口 `/api/fleet/v1/stats/daily`（fleet 口径数组：day/source/basis/tokens_in/tokens_out/turns）。错误边界按面板隔离已存在（spec「渲染异常不得退化成空白页」）。

## Decisions

### D1 抽屉：右侧固定抽屉一次一个，state 提升不重写面板

- 新组件 `Drawer.jsx`（自绘：fixed 覆盖层 + 右侧滑入面板，Esc/点遮罩关闭，`role="dialog"` + `aria-modal`）。
- FleetView 用一个 `openPanel` state（`{slug, kind}`）替换六处 `{x && …}` 堆叠：面板组件本体（表单、端点调用、错误分语、testid）**原样搬进抽屉**，只改承载容器。深链 `#/console/<slug>` 照旧解析为 `openPanel={slug, "config"}`。
- 暂停/恢复按钮留在卡片上（高频一键操作不进抽屉）；「配置/记录/记忆/额度/嵌入/允许清单」六按钮开抽屉对应面板（「我的收益（分成）」是部署卡常驻区而非按需面板，不进抽屉——实现时核实的修正）。
- 同一时刻只开一个面板：与现状「一屏只能专注一个面板」等价，且避免抽屉内嵌套。

### D2 toast：自绘 40 行，只报成功；错误仍就地分语

- 新组件 `Toast.jsx`：`useToast()` 提供 `toast(text)`，右下角堆叠、3s 自动消失、`role="status"`（live region 屏幕阅读器可达）。
- **只用于成功反馈**（保存配置、嵌入设置、额度、暂停恢复、遗忘成功）。错误继续走既有面板/卡片横幅——错误需要停留、可复制、分语（403 vs 网络不可达语义不同），toast 会自动消失吞掉细节。这是刻意的单一职责，不做 toast 报错。

### D3 每日序列：echarts 按需引入，柱状图按口径分系列

- 依赖 `echarts`（按需 `echarts/core` + BarChart + GridComponent + CanvasRenderer，控制体积）；新组件 `DailyChart.jsx` 替换 StatsView 手搓条。x=day，系列=source/basis 组合（fleet/estimated、sub2api/billed、local/estimated 各一色），y=tokens。
- 口径分列语义不变（绝不合口径）；`data-testid="stats-daily"` 挂图表容器保留走查锚点；窗口无数据仍显示「窗口内无数据」空态。echarts 容器设固定高度，dark 模式跟随（textStyle/axisLine 读 `document.documentElement.classList` 的 dark）。

### D4 代码分割：React.lazy 切登录后重面

- `App.jsx`：ConsoleView、ChatView、CollectionsView、BundleView 改 `lazy(() => import(…))` + Suspense fallback（局部骨架，不用 spinner 文字）。对外门面 IntroView/CatalogView/DocsView 与 EmbedView 保持静态 import（首屏/嵌入路径不引入额外往返）。
- vite 自动按动态 import 分 chunk，无需配置。

### D5 视觉基线走 token，不做组件库

- Tailwind v4 `@theme` 定义 accent 主色（如 `--color-accent-*`，取值在 Phase 2 critique 后定）与节奏 token（圆角/内边距/字号阶梯）；替换点按「关键操作/选中态/链接」最小集，不全站刷色。
- 字号：正文最小 text-xs（12px）；text-[10px] 全部升级或降格为辅注 text-[11px]。骨架屏自绘（`animate-pulse` 色块），不引骨架库。
- aria 基线只补交互控件（按钮名、dialog、live region、输入 label 关联），不追求全量 WCAG 审计。

## Non-goals

- 不引路由库/组件库/状态库；不改任何 facade/observer 端点与语义。
- 不做移动端专门布局（现有响应式类保留）；不做 i18n（全站中文既定）。
- 不动 chat/embed 视图的对话流逻辑（仅懒加载包裹）。

## Risks / Trade-offs

- FleetView 重排是全 change 最大 diff——以「data-testid 清单逐项比对不变」为硬判据，配合生产走查（aloadtree 账号登录实点七面板）。
- echarts 增加 ~150KB gzip 前后对比——吃 D4 的代码分割对冲，且只进消耗页 chunk。
- 懒加载引入首切白屏瞬间——Suspense fallback 骨架兜住。
