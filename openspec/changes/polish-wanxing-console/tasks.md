# Tasks — polish-wanxing-console

## 1. Phase 1：抽屉收编

- [ ] 1.1 新建 `components/Drawer.jsx`（fixed 遮罩+右侧滑入、Esc/遮罩关闭、role=dialog、aria-modal、焦点入抽屉）。验证：手工 DOM 断言开关与 Esc。
- [ ] 1.2 FleetView：`openPanel {slug,kind}` state 替换七处面板堆叠，面板本体原样搬入抽屉；深链 `#/console/<slug>` 开 config 抽屉；暂停/恢复留卡片。验证：`grep data-testid` 清单与改前逐项一致。
- [ ] 1.3 `npm run web:build` 绿 + 本地走查五 tab 不回归。

## 2. Phase 1：toast + 每日序列图 + 代码分割

- [ ] 2.1 新建 `components/Toast.jsx`（useToast、右下堆叠、3s 消失、role=status）；FleetView/DeployWizard/StatsView 写操作成功接 toast。验证：走查保存配置见 toast、断网失败仍就地错误横幅。
- [ ] 2.2 依赖 `echarts` 按需引入；新建 `DailyChart.jsx` 替换 StatsView 手搓条（x=day、系列=source/basis、dark 跟随）；`stats-daily` testid 保留，空态文案不变。验证：本地有数据窗口柱状图眼见、三口径分列。
- [ ] 2.3 App.jsx：ConsoleView/ChatView/CollectionsView/BundleView 改 React.lazy + Suspense 骨架 fallback。验证：`web:build` 产物多 chunk、intro 首屏 chunk 不含 console 代码。
- [ ] 2.4 构建绿 + 五 tab 走查全过。

## 3. Phase 2：视觉基线（critique 先行）

- [ ] 3.1 登录态截图 critique（aloadtree 走查账号：五 tab + 抽屉 + 图表 + 窄屏），产出缺陷清单与 accent 取值定案。验证：截图存 `gui-test-screenshots/`。
- [ ] 3.2 `@theme` 落 accent 与节奏 token；关键操作/选中态/链接换 accent。验证：走查眼见主色、dark 模式对比度可读。
- [ ] 3.3 字号阶梯：text-[10px] 清零（正文 ≥12px），辅注统一 text-[11px]。验证：`grep -c 'text-\[10px\]' wanxing-web/src` = 0。
- [ ] 3.4 骨架屏替换六处「加载中」文字 + 交互控件 aria 基线（按钮名/dialog/live region/label 关联）。验证：走查加载态眼见骨架、键盘 Tab 焦点可见。
- [ ] 3.5 Phase 2 走查全过 + 构建绿。

## 4. 出片与验收

- [ ] 4.1 fd-build-channel 判路 → wanxing-web 出片 → gitee fd-infra-deploy 滚 tag → ArgoCD Healthy。验证：digest 双证。
- [ ] 4.2 生产验收：aloadtree 登录 console 五 tab 走查（抽屉七面板、toast、每日图、骨架、accent）。验证：浏览器真机眼见 + 截图存证。
- [ ] 4.3 台账 + 主 spec 同步（wanxing-web delta 合入）+ 归档 + 记忆更新。
