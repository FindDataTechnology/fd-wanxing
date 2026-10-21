# Tasks — add-plan-requests-and-move-statement

## 1. facade：申请存储与路由

- [x] 1.1 store.js：`wanxing_plan_requests` 表迁移 + `planRequestAdd(userId, email,
  limitMinutes, note)` / `planRequestList({ scope })`（本人或全量，pending 置顶）/
  `planRequestGet(ref)` / `planRequestDecide(ref, status, by, note)`。验证：store 层直测
  （增/列/判三态与置顶）
- [x] 1.2 console.js：`POST /console/plan-requests`（登录身份自助，limit ∈ [60,1e6] 整数，
  note ≤200 字）；`GET /console/plan-requests`（ops=全量队列 / 身份=仅本人）；`PUT
  /console/plan-requests/:ref`（opsOnly：approve→先 `store.planSet` 再标 approved；
  reject→只标）。验证：路由层测试四线（自助+列表双视角/批准落地 plan/驳回零发放/非 ops
  403 不见他人）
- [x] 1.3 facade 测试收口：`test-wanxing-plans.mjs`（或新文件）补上述场景全绿；回归
  `test-wanxing-console.mjs` 不红

## 2. web：迁卡 + 申请面 + 运维队列

- [x] 2.1 对账卡迁 `StatsView` 顶部（`my-statement-panel`/`my-statement-body` 键随卡走；
  FleetView 撤卡，向导/收益不动）。验证：stub dist——舰队页无卡、消耗页有卡且数字/错误
  路径不变
- [x] 2.2 对账卡内「申请套餐」折叠表单（三档建议 500/2000/10000 + 自定义 + 备注）与
  「我的申请」状态列表（pending/approved/rejected 徽标 + 审批备注）。验证：stub dist
  提交→列表见 pending
- [x] 2.3 OpsView 待审队列：pending 置顶计数、批准/驳回（带备注）按钮，动作后刷新。
  验证：stub dist（ops 令牌态）批准→队列消 pending
- [x] 2.4 `vite build` 绿 + 既有 testid 回归（fleet-empty/fleet-cards/wizard-* 不受迁卡
  影响）
  （stub dist 走查三轮：`scripts/stub-console-web.mjs` 喂 dist + 真 console 路由，ego
  DOM 断言——舰队页无卡/向导收益空态键在；消耗页卡在三口径之上、标题释义数字原样；
  建议档 2000→提交→待审行；越界 60–1000000 客户端拦；ops 队列 1 待审→批准带备注→
  0 待审+套餐列表 2000「欢迎使用」；二笔 90000→驳回带备注→已处理列表双态；调用者回看
  套餐上限 2000+两条审批备注、切换语「申请调整套餐」；peer 身份零行；ops 令牌消耗页
  仅身份缺失提示无申请面；登录身份运维面队列闭合无按钮。DeployWizard 零 diff、22 个
  wizard-* 键在源。）

## 3. 出片滚产与真机

- [ ] 3.1 双镜像同车出片（fd-build-snapshot，`--ref` 钉本 change commit；池变量四件套
  核对）+ gitee 滚 tag + ArgoCD 硬刷新 + relay 逐 tag OK 行 + 双 digest 实证；台账 §9
- [ ] 3.2 生产真机全链：aloadtree 提交申请→（ops 令牌）OpsView 批准→对账卡套餐行出现/
  调整生效→驳回路径一次；留探针输出
