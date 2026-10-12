## 1. 修复

- [ ] 1.1 a2a.js send 路径：outcome 从 `out.response?.error` 派生；exec 的 `doc ?? …` 兜底改为显式 JSON-RPC error（-32001）
- [ ] 1.2 chat.js send 路径同款
- [ ] 1.3 回归测试（scripts/test-wanxing-facade.mjs 增 3 例）：API 车道 200+JSON-RPC error → usage outcome=error、minutes 0、无 earnings；chat 车道同款；错误回合 replay 回放原响应且零新 usage。既有 3.1/4.x 例全绿不回归

## 2. 历史伤害清点（生产账本交叉）

- [ ] 2.1 预检规模：`wanxing_usage` outcome='ok' ∧ `wanxing_requests.response` LIKE '%\"error\":{\"code'% 交集行数与金额
- [ ] 2.2 逐行退款：sub2api admin balance（Idempotency-Key=usage id，幂等可重放）；drill 号外的真实调用者优先核对
- [ ] 2.3 earnings 侧对冲：对应 share 行的处理（按 2.1 实况定：deployer 侧负 adjust 或标记 void，保持 sub2api 与账本一致）

## 3. 部署与生产复证

- [ ] 3.1 fd-wanxing 出片（GHA 路线按 paas-release 判梯）→ ccr 落地实证 → GitOps 滚 wanxing-facade
- [ ] 3.2 生产复证：上游仍故障则用同款 502 复现——失败回合 usage 行 outcome=error、minutes_billed=0、settlement waived、无 earnings 行；上游已恢复则补一次成功回合计费正路（1min×$0.10 settled+分成）
- [ ] 3.3 影子核查：滚后观察 15 分钟，无 pending 悬挂、sweep 正常

## 4. 收尾

- [ ] 4.1 F3.3 案例卡挂账②翻案（docs/ecosystem/selfhost-funnel-case.md，paas 仓）
- [ ] 4.2 openspec 归档（validate --specs 前置）+ 记忆
