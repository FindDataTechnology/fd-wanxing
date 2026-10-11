# tasks — add-mission-definitions

## 1. 存储

- [ ] 1.1 store.js：`wanxing_missions` 建表（幂等）+ `wanxing_usage` 迁移 `mission_id` 列 + `wanxing_mission_writebacks` 幂等表；mission CRUD（create 校验四元组/List by owner/List all/Get 详情含派生 spent），验证单测：建表幂等、非法四元组拒绝、planning 后四元组冻结

## 2. 状态机

- [ ] 2.1 `transition(mission, to, by)` 纯函数 + 转移表（design D2）；所有写状态入口共用；乐观并发（UPDATE WHERE status），验证单测：全合法路径（human/auto 两模式）、终态后转移拒绝、abort 优先级、并发冲突落非法转移

## 3. 派发与回写

- [ ] 3.1 missions.js 模块：submit 触发异步派发（复用 a2a upstream 通道 + forwardHeaders，fire-and-forget + 重试 1 次仍败→failed）、纪元凭据铸造/失效、时间窗过期拒绝（409 MISSION_WINDOW_EXPIRED）、MISSING_PLANNER 降级拒绝，验证单测：派发受理进 planning、过期窗拒绝、无 slug 时 submit 拒绝且 draft 保留、派发失败落 failed
- [ ] 3.2 `POST /missions/:id/writeback`（X-Mission-Token 纪元门 + (mission,idem_key) 幂等回放 + 经状态机推进；plan/ready/step/report/fail 五 kind），验证单测：plan 落库推进 awaiting_approval|auto_approved、凭据失效拒绝、同键重放同结果、跨状态非法 kind 拒绝

## 4. 成本闸与记账

- [ ] 4.1 recordUsage 加 mission 维度（派发链路透传）+ 派发入口闸（派生 spent ≥ cap → 402 MISSION_EXHAUSTED，不中断已跑回合），验证单测：三回合各 1 分钟派生 spent=3、cap 耗尽拒派发、进行中回合自然入账

## 5. console 面与 API

- [ ] 5.1 console routes：missions CRUD/submit/approve/abort（owner 门）+ all/abort（opsOnly 沿 plans 先例），验证单测：owner 只见自己、ops 见全部、approve 前置校验、abort 非终态
- [ ] 5.2 wanxing-web ConsoleView「我的任务」面板（列表/详情/approve/abort/planner 未配置降级态显式），验证：面板 walkthrough（沿 my-statement-panel 先例 data-testid）

## 6. 观测与收尾

- [ ] 6.1 转移事件接 fleet report 通道（mission.<transition> 全集，失败不阻塞），验证单测：转移即一条事件、通道异常转移照常
- [ ] 6.2 walkthrough 脚本 + 全量单测绿 + 推送 CI 绿，验证：node --test 全绿 + CI 步骤级结论
