# Proposal: upgrade-wanxing-footer

## Why

wanxing-web 页脚是全家族最薄的一条：一行「萬星 Wanxing · 寻数 constellation 线 · 寻数科技」。
`add-intro-view` 解决了「落地即介绍」，但访客看完介绍/目录/文档后，页脚不再提供任何家族坐标
与完整回头入口。识律（lex）页脚是家族现状基准：品牌区 + 「寻数产品线」列表（当前站点徽）+
入口列 + 头条声明；本轮（2026-10-05 grill 定案）对齐它，并把五线列表升级为「一十百千万」阶梯
的**文本型图示**（文本方章当图标），同时补齐联系块、公司使命句与两条备案。

## What Changes

- **页脚升级（`wanxing-web/src/App.jsx` 内联页脚 → 家族页脚）**：
  1. 品牌区：双字方章「萬星」+ 萬星 + 定位短语「Agent 服务的对外运行与服务平台」；
  2. 联系块：标签「联系」+ `1253774197@qq.com`（mailto）+ `17753221425`（tel:+86），
     与谦面站同款；
  3. 「寻数产品线」阶梯：五行 = 双字方章（壹座/识律/柏讯/谦面/萬星）+ **汉字数字列**
     （一/十/百/千/万）+ 契约线名（寻数·…）；萬星行标「当前站点」；整行可点 →
     `https://www.finddatatech.cloud/zh/products/<line>/`；纯文本零图片；
  4. 入口列：介绍 / 目录 / 文档 / 控制台 / 官网萬星线页（延续 `add-intro-view` 已定的
     线页回链目标 `/zh/products/constellation/`）；
  5. 公司使命句（逐字）：「寻数科技聚焦AI时代下的文本和数据处理的基础设施建设，致力于推动
     信息平权，最终促进社会公平。」——整行文本、允许折行、不缩字号；
  6. 版权行 `© 2026 寻数（FindData）· 萬星 Constellation` + 两条备案：
     `粤ICP备2026118740号-1`（链 beian.miit.gov.cn）与 `粤公网安备44030002016558号`
     （链 beian.mps.gov.cn 查询页），纯文本链接不挂警徽图片。
- **header 单字方章**：站点名「萬星」旁挂单字文本方章「萬」（CSS 方块、零图片）；小字
  「Agent 服务目录与运营台」保留不动。记号规则：导航栏单字、页脚品牌区与阶梯行双字。
- **新组件**：`SiteMark.jsx`（单字/双字两态）与 `LineLadder.jsx`（阶梯五行）——纯展示、
  零依赖、零状态。
- 站点保持纯中文（不引 i18n，与 `add-intro-view` 的 non-goal 一致）；不改动介绍 / 目录 /
  文档 / 控制台内容；窄屏下阶梯行与入口列可换行或竖排，不产生横向溢出。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `wanxing-web`:
  - ADDED「The site footer carries the five-line ladder」（双字方章 + 汉字数字列 + 契约线名 +
    「当前站点」标记 + 整行可点 → 官网线页 + 窄屏换行）；
  - ADDED「The site footer carries brand, contact, mission, and filing statements」（品牌区 /
    联系块 / 入口列 / 使命句 / 版权与两条备案）；
  - ADDED「The site header carries the single-character site mark」（导航单字方章、品牌区双字
    方章、零图片）。

## Non-goals

- 英文版页脚（站点纯中文，与 `add-intro-view` 的 non-goal 一致）；
- 介绍视图 / hero / 目录 / 文档 / 控制台内容改动；
- 谦面侧页脚（paas 仓 `add-facet-intro-view` 另立）；官网页脚（fd-official-web 仓
  `add-mps-filing` 另立）；柏讯 / 识律反哺对齐；
- 活数据（机群水位 / 目录计数）——页脚不接运行时状态。

## Impact

- **Code**: `wanxing-web/src/App.jsx`（页脚区块替换 + header 方章）、新增
  `wanxing-web/src/components/SiteMark.jsx`、`wanxing-web/src/components/LineLadder.jsx`；
  无依赖变更、无服务端改动。
- **Pages**: `wanxing.finddatatech.cloud` 四视图共享页脚（hash 路由不变）。
- **部署**: fd-wanxing 仓镜像线（GHA → TCR → GitOps bump；与 `add-intro-view` 2026-10-05
  的发布线一致）。
- **事实核验**: 线名与数字映射取自官网命名契约（壹=1、识=10、柏=100、谦=1000、萬=10000，
  数字列写作汉字）；两条备案号与官网一致；阶梯与方章为纯文本，无新增图片资产。

## 验收口径

- `npm --prefix wanxing-web run build` 绿；
- 本地 `vite preview` 目检：四视图共享新页脚；阶梯五行齐全、萬星「当前站点」标记、整行链接
  可达；联系块与两条备案在页；header 单字方章；375px 窄屏无横向溢出（证据截图落
  `gui-test-screenshots/`）；
- 部署后探针：wanxing 域新 bundle 含阶梯字符、使命句与两条备案号，壳 title 不变。