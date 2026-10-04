# Tasks

- [x] 1. 抽 A2aSample 共享组件（DocsView 内联 curl 样例等价替换为组件引用），
  DocsView 渲染结果不变
- [x] 2. IntroView 静态骨架：hero（定位句+副标+双 CTA）/ 三特性卡 / 工作原理
  一行图 / A2aSample quick facts——双层口吻文案
- [x] 3. hash 路由调整：`#/`=IntroView、目录挪 `#/catalog`、tab 四个
  （介绍/目录/文档/控制台）；footer 官网链接改
  `https://www.finddatatech.cloud/zh/products/constellation/`
  （实测裸域 finddatatech.cloud 不解析——旧 footer 链接为潜在死链，一并修正）
- [x] 4. 本地验收：`vite build` 绿；浏览器实机全绿——落地即介绍（四 tab/hero/
  特性卡/工作原理/样例/footer 线页链接）、目录挪 `#/catalog` 且降级语义不变、
  文档视图样例单源等价渲染、控制台无回归（证据：gui-test-screenshots/t1-t3）；
  验证环境=本地 `vite preview`（无 facade，目录视图按 spec 显式降级，非缺陷）
- [x] 5. 部署验收（2026-10-05）：commit `84fa8d1` → GHA images run
  37228709932 绿 → tcr-relay 03:39:03 回灌 ccr（sha-84fa8d1）→ GitOps
  `eca22fa` bump → ArgoCD hard refresh → rollout 成功 → 线上探针：
  wanxing.finddatatech.cloud 壳 title 不变、新 bundle `index-Bu-Z6V7n.js`
  含「Agent 服务的对外运行与服务平台/部署 · 驻留 · 门面 · 计费与机群观测/
  浏览已上线的公开 Agent 服务」——介绍视图 LIVE