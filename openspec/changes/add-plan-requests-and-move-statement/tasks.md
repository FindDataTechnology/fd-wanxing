# Tasks — add-plan-requests-and-move-statement

## 1. facade：申请存储与路由

- [ ] 1.1 store.js：`wanxing_plan_requests` 表迁移 + `planRequestAdd(userId, email,
  limitMinutes, note)` / `planRequestList({ scope })`（本人或全量，pending 置顶）/
  `planRequestGet(ref)` / `planRequestDecide(ref, status, by, note)`。验证：store 层直测
  （增/列/判三态与置顶）
- [ ] 1.2 console.js：`POST /console/plan-requests`（登录身份自助，limit ∈ [60,1e6] 整数，
  note ≤200 字）；`GET /console/plan-requests`（ops=全量队列 / 身份=仅本人）；`PUT
  /console/plan-requests/:ref`（opsOnly：approve→先 `store.planSet` 再标 approved；
  reject→只标）。验证：路由层测试四线（自助+列表双视角/批准落地 plan/驳回零发放/非 ops
  403 不见他人）
- [ ] 1.3 facade 测试收口：`test-wanxing-plans.mjs`（或新文件）补上述场景全绿；回归
  `test-wanxing-console.mjs` 不红

## 2. web：迁卡 + 申请面 + 运维队列

- [ ] 2.1 对账卡迁 `StatsView` 顶部（`my-statement-panel`/`my-statement-body` 键随卡走；
  FleetView 撤卡，向导/收益不动）。验证：stub dist——舰队页无卡、消耗页有卡且数字/错误
  路径不变
- [ ] 2.2 对账卡内「申请套餐」折叠表单（三档建议 500/2000/10000 + 自定义 + 备注）与
  「我的申请」状态列表（pending/approved/rejected 徽标 + 审批备注）。验证：stub dist
  提交→列表见 pending
- [ ] 2.3 OpsView 待审队列：pending 置顶计数、批准/驳回（带备注）按钮，动作后刷新。
  验证：stub dist（ops 令牌态）批准→队列消 pending
- [ ] 2.4 `vite build` 绿 + 既有 testid 回归（fleet-empty/fleet-cards/wizard-* 不受迁卡
  影响）

## 3. 出片滚产与真机

- [ ] 3.1 双镜像同车出片（fd-build-snapshot，`--ref` 钉本 change commit；池变量四件套
  核对）+ gitee 滚 tag + ArgoCD 硬刷新 + relay 逐 tag OK 行 + 双 digest 实证；台账 §9
- [ ] 3.2 生产真机全链：aloadtree 提交申请→（ops 令牌）OpsView 批准→对账卡套餐行出现/
  调整生效→驳回路径一次；留探针输出
