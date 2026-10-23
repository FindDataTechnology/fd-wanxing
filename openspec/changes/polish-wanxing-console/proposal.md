# Proposal: polish-wanxing-console

## Why

萬星部署者控制台（wanxing-web `#/console` 五 tab：舰队/任务/桌面机位/消耗/运维）功能已齐，但 IA 与体验欠账集中：FleetView 单文件 40.7K，七个管理面板（配置/记录/记忆/额度/嵌入/允许清单/分成）顺序堆叠在部署卡片下方，开一个面板整页拉长一截；写操作反馈靠零散 inline 文案，没有统一 toast；消耗视图的每日序列是手搓 div 横条，看不出趋势；整个 SPA 单 bundle 408KB 无代码分割；视觉上 text-[10px] 正文约 22 处、无品牌 accent（全 slate+amber）、无骨架屏（六处「加载中」文字）、aria 属性全站仅 3 处。2026-10-24 explore 定稿（ai-memory `wanxing-console-polish-plan`）：IA/体验重构 + impeccable 视觉打磨合成一个 change 两阶段，本刀落地。

## What Changes

**Phase 1（IA/体验）**
- fleet tab 管理面板收编为**抽屉**：七面板从「卡片下方顺序堆叠」改为右侧抽屉，一次一个；面板行为、端点、data-testid 全部不变，深链 `#/console/<slug>` 开对应部署的抽屉。
- **统一 toast**：写操作（保存配置/嵌入设置/暂停恢复/额度编辑/遗忘）成功以自动消失的 toast 反馈；错误仍就地分语（既有面板/卡片横幅），toast 不吞错误细节。
- **每日序列真图**：消耗视图的每日序列用 echarts 柱状图渲染（x=day，系列按口径 source/basis 分组），替换手搓 div 条；口径分列语义与 `stats-daily` testid 保留。
- **控制台代码分割**：登录后重面（console/chat/collections）改 `React.lazy` + Suspense，构建多 chunk；对外公开面（intro/catalog/docs）与嵌入面（embed）不切。

**Phase 2（impeccable 视觉基线，critique 用登录态截图走查后动工）**
- **字号阶梯**：正文最小 12px（text-xs），消灭 text-[10px] 正文用途；辅注 text-[11px] 保留。
- **萬星 accent 色板**：@theme 定义品牌主色 token，关键操作/选中态/链接用 accent，替换 slate 一统。
- **骨架屏 + 焦点态 + aria 基线**：主面板加载用骨架替代「加载中」文字；键盘焦点可见；交互控件可达命名补齐。
- **节奏统一**：卡片圆角/内边距/按钮尺寸/表格样式归一 token。

## Capabilities

### Modified Capabilities

- `wanxing-web`：fleet 管理面板承载从「卡片下方堆叠」改为抽屉（MODIFIED，行为与 testid 不变）；另新增 toast 反馈、每日序列图表、懒加载、视觉基线四块 ADDED 需求。

## Impact

- 纯 web 刀（`wanxing-web/`），facade/observer 零改动——每日序列接口 `/api/fleet/v1/stats/daily` 已存在（add-stats-plane-v1）。
- 新依赖一个：`echarts`（图表刚需；不引路由库/组件库，抽屉与 toast 自绘）。
- 风险面：FleetView 重排是最大 diff，靠 testid 清单不变 + 生产走查兜底；懒加载改 App.jsx 装载路径。
- 出片沿 fd-wanxing 标准线：GHA → ccr `yizuo/wanxing-web` → gitee fd-infra-deploy 滚 tag → ArgoCD。
