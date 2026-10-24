# Tasks — polish-wanxing-console

## 1. Phase 1：抽屉收编

- [x] 1.1 新建 `components/Drawer.jsx`（fixed 遮罩+右侧滑入、Esc/遮罩关闭、role=dialog、aria-modal、焦点入抽屉）。验证：手工 DOM 断言开关与 Esc。
- [x] 1.2 FleetView：`openPanel {slug,kind}` state 替换六处面板堆叠（实现核实的修正：「分成/我的收益」是部署卡常驻区不是按需面板，不进抽屉），面板本体原样搬入抽屉；深链 `#/console/<slug>` 开 config 抽屉；暂停/恢复留卡片。验证：`grep data-testid` 清单与改前逐项一致（20 原样保留 + 新增 config-panel/allowlist-panel 两枚，零删除零改名）。
- [x] 1.3 `npm run web:build` 绿 + 本地走查五 tab 不回归（ego mock 后端实点：六面板开抽屉/Esc/遮罩/X 关闭/一次一个/焦点与 aria 全过，零 pageerror）。

## 2. Phase 1：toast + 每日序列图 + 代码分割

- [x] 2.1 新建 `components/Toast.jsx`（useToast、右下堆叠、3s 消失、role=status）；FleetView 写操作成功接 toast（暂停恢复/存配置/加移调用者/存额度/存嵌入/遗忘）。验证：走查保存额度见 toast、3s 自动消失；mock 500 失败就地横幅、无 toast（错误不走 toast 语义实证）。
- [x] 2.2 依赖 `echarts@6` 按需引入（core+Bar+Grid+Legend+Canvas）；新建 `DailyChart.jsx` 替换 StatsView 手搓条（x=day、系列=source/basis、系统 dark 跟随）；`stats-daily` testid 保留，空态文案不变。验证：走查 canvas 966×260 眼见、双口径分列图例（截图存证）。
- [x] 2.3 App.jsx：ConsoleView/ChatView/CollectionsView/BundleView 改 React.lazy + Suspense 骨架 fallback。验证：`web:build` 产物 6 chunk（原单 bundle 408KB → 初始 index 283KB + ConsoleView 580KB 含 echarts 独立加载）；intro chunk 实测不含 console 代码。
- [x] 2.4 构建绿 + 五 tab 走查全过。

## 3. Phase 2：视觉基线（critique 先行）

- [x] 3.1 登录态截图 critique（八张：五 tab + 抽屉 + 窄屏 + 浅色，存 `gui-test-screenshots/critique-*.png`），定案缺陷清单（零品牌色/30 处 text-[10px]/六处加载文字/aria 3 处）与 accent 取值 = 站标印章红 #A6402F（SiteMark「家族记号成套」）。验证：截图存 `gui-test-screenshots/`。
- [x] 3.2 `@theme` 落 accent 四 token（#A6402F + strong/soft/wash，dark 媒体覆盖提亮），31 处主操作/选中态换 `bg-accent`、4 处链接换 accent。验证：走查 computed backgroundColor = rgb(166,64,47)、light/dark 双模式眼见（p2-accent-*.png）。
- [x] 3.3 字号阶梯：text-[10px] 29 处全部升至 text-[11px]（辅注/徽章），SiteMark 阶梯行 1 处豁免（家族印章记号规范，非正文）。验证：`grep 'text-\[10px\]'` 仅剩 SiteMark。
- [x] 3.4 骨架屏替换加载文字（Skeleton.jsx Lines/Cards 两形态：ChatView/BundleView/OpsView×2/DeployWizard；CatalogView 计数行是瞬态状态文字保持）+ 16 个真裸输入补 aria-label（label 包裹内免）。验证：走查 DOM 断言「无 <11px 文本」「输入全命名」双 yes。
- [x] 3.5 Phase 2 走查全过（截图 p2-final-*.png：accent 暗浅双模式、每日图富数据趋势）+ 构建绿。

## 4. 出片与验收

- [ ] 4.1 fd-build-channel 判路 → wanxing-web 出片 → gitee fd-infra-deploy 滚 tag → ArgoCD Healthy。验证：digest 双证。
- [ ] 4.2 生产验收：aloadtree 登录 console 五 tab 走查（抽屉六面板、toast、每日图、骨架、accent）。验证：浏览器真机眼见 + 截图存证。
- [ ] 4.3 台账 + 主 spec 同步（wanxing-web delta 合入）+ 归档 + 记忆更新。
