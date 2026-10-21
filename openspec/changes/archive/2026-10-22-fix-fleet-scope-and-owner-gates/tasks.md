# Tasks — fix-fleet-scope-and-owner-gates

## 1. facade：列表过滤与归属闸

- [x] 1.1 `/console/deployments` 按身份过滤：`gate()` 通过且为登录身份时只返回
  `deployedBy`（lowercase 比较）等于本人的行；无 `deployedBy` 的行仅 ops 令牌可见。
  验证：facade 测试——他人部署不出现在登录身份的列表、ops 全量
- [x] 1.2 `pauseAction` 过 `ownerGate`：非部署者 403 且 registry 元数据零改动；本人与
  ops 语义不变（`effectiveWithinSecs` 口径保留）。验证：facade 测试双面
- [x] 1.3 callers 读/增/删过 `ownerGate`：非部署者三动作全 403、白名单零改动；本人与
  ops 200。验证：facade 测试双面
- [x] 1.4 facade 测试收口：既有 console 测试文件补「过滤 / 越权 403 / ops 全量」三类
  场景全绿（`node --test` 对应文件零红）

## 2. web：拒绝显性化与空态

- [x] 2.1 FleetView per-card 动作错误 note：`loadConfig/loadCallers/loadAllowance/
  loadEmbed` 失败时按 `slug:action` 键控渲染在卡片动作行下方（不再只写进未打开面板的
  note state）。验证：web 测试断言错误文案出现在卡片内而面板未开
- [x] 2.2 错误分型文案：403 → 「非本人部署/无权」归属措辞；5xx 与网络错误 → 可重试
  措辞并点名失败面；记录面板对 403 的「请稍后再试」误导修正。验证：web 测试按状态码
  断言两套文案
- [x] 2.3 空舰队空态：名下零部署时渲染「暂无部署」引导至部署向导（data-testid
  稳定可断言），不再渲染空网格。验证：web 测试空列表断言
- [x] 2.4 web 回归：本人卡六按钮与 summary 信号列、allowance 进度条行为不变。验证：仓无
  web 单测基建——`vite build` 绿 + 本地 stub 服务器（dist 产物）浏览器四线实测：403 卡片
  文案、500 重试文案、200 面板回归、空态；facade 回归 90+3 全绿

## 3. 真机验收与出片

- [x] 3.1 真机三线走查（ego/等价 harness）：账号 A（名下有部署）只见本人卡、全按钮
  绿；他人部署路径直打 API 403 且页面对应文案；ops 令牌实探列表全量与 pause/白名单
  动作不变。留证据截图/探针输出
  （2026-10-22 生产实证：aloadtree 只见本人 5 卡〔识律/宏观/估值/Planner/一键流〕，
  本人卡配置+记录面板 200 开；他人 slug callers GET 403；深链他人 slug→孤儿区级
  「配置未打开——这不是你部署的 agent…」文案命中；ops 令牌全量 15 条与 DB 对账一致。
  截图因 ego 窗口最小化未拍，DOM 文本断言为证）
- [x] 3.2 出片与滚产：facade + web 两镜像同车（fd-build-snapshot，源仓先推 origin），
  滚版后复跑 3.1 三线；台账（docs/registry-maintenance.md §9）记发布
  （testaction005 通用池；facade 修复由姊妹 change 的 sha-6f5331d〔源 0c8c5c0，父=
  本 change 5f10e4e〕承运上产 digest 8515e54f，自有片 c3e76f7 留作回滚位；web
  sha-d5aa0be〔源 de73bc4〕digest 2ed27bca，gitee d149953/bed0460 + ArgoCD 硬刷新）
