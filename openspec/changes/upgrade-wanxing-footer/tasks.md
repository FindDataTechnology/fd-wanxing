# Tasks

## 1. 组件（文本方章与阶梯）

- [x] 1.1 新增 `wanxing-web/src/components/SiteMark.jsx`（文本方章，单字/双字两态，CSS 方块、
  零图片零依赖）——验证：`npm --prefix wanxing-web run build` 绿
- [x] 1.2 新增 `wanxing-web/src/components/LineLadder.jsx`：五行 = 双字方章 + 汉字数字
  （一/十/百/千/万）+ 契约线名；萬星行标「当前站点」；整行可点 →
  `https://www.finddatatech.cloud/zh/products/<line>/`——验证：本地 `vite preview` 目检五行、
  当前线标记、链接目标（逐行）

## 2. 页脚与 header

- [x] 2.1 `wanxing-web/src/App.jsx` 页脚替换为家族页脚：品牌区（[萬星] 萬星 · Agent 服务的
  对外运行与服务平台）+ 联系块（`mailto:1253774197@qq.com`、`tel:+8617753221425`）+
  LineLadder + 入口五项（介绍 / 目录 / 文档 / 控制台 / 官网萬星线页）+ 使命句（逐字：
  「寻数科技聚焦AI时代下的文本和数据处理的基础设施建设，致力于推动信息平权，最终促进社会
  公平。」）+ 版权行与两条备案（ICP → beian.miit.gov.cn；公网安备 → beian.mps.gov.cn
  查询页，纯文本不挂警徽）——验证：本地 `vite preview` 目检四视图（`#/`、`#/catalog`、
  `#/docs`、`#/console`）页脚一致
- [x] 2.2 header 站点名旁挂单字方章「萬」（「Agent 服务目录与运营台」小字保留）——验证：
  本地目检；产物无新增图片资源
- [x] 2.3 窄屏适配：阶梯行与入口列在 375px 宽可换行/竖排、无横向溢出——验证：浏览器 375px
  实机目检（证据截图落 `gui-test-screenshots/`）

## 3. 部署验收

- [x] 3.1 commit → GHA images 绿 → tcr-relay 回灌 ccr → GitOps bump → ArgoCD hard refresh
  → rollout 成功 → 线上探针：wanxing 域新 bundle 含阶梯字符（一/十/百/千/万 与
  壹座/识律/柏讯/谦面/萬星）、使命句与两条备案号，壳 title 不变；线页入口可达