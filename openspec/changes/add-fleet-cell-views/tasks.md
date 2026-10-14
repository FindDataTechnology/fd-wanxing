# add-fleet-cell-views — 任务清单

## 1. observer

- [ ] 1.1 `store.js`：EVENT_KINDS 收 `cell_stats`（枚举注释）
- [ ] 1.2 `observer.js` board：`cells` 段（30 分钟窗最新/agent）+ `shortterm` 汇总
       （cells/running/queued/workers busy/idle/cap，防御式求和）；不进 agents/states
- [ ] 1.3 `scripts/test-fleet-observer.mjs` 追加：cell_stats 摄取+cells/shortterm 合成；
       空窗口保形；agents_total 不变；未知 kind 仍 400

## 2. console

- [ ] 2.1 OpsView：短期执行区（汇总条+每 cell 行+采样年龄）+ runners 行 pod 徽标 +
       未升级降级提示
- [ ] 2.2 web 构建/lint 过

## 3. 发布与实证

- [ ] 3.1 observer+web 发布线滚产（先于 paas 侧开门）
- [ ] 3.2 生产眼见：paas 配 env 后 board cells 填充、OpsView 统一视图渲染（与 paas 仓
       change 的 5.2 同一验收）
