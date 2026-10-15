## Why

萬星管理面统一（paas 仓 change `unify-wanxing-management-plane`，切片⑤）把 cell 内短期执行以
只读遥测送进舰队面：gateway 代采各 cell 的任务 stats、以 `cell_stats` 事件投本 observer 的
ingest。observer 现在的事件白名单不认识这个 kind，board 也没有短期执行段——本仓这半边不收，
整条链就断在终点前。

## What Changes

- observer `EVENT_KINDS` 白名单收 `cell_stats`（枚举制，不开通配）。
- board 增两段：`cells`（30 分钟窗内每 cell 身份最新一条 payload，与 runners 段同构）+
  `shortterm` 汇总（cells 数、在跑/排队执行数、worker 池 busy/idle/cap 合计）。cell 身份
  **不进** `agents_total`/`states` 口径（那是常驻 serving agent 的分布）。
- 良机 console OpsView：机群总览增「短期执行」区——汇总条 + 每 cell 行（身份/在跑/排队/
  worker 池/近 1h 终局/采样年龄）；runners 行补 pod 密度徽标（board runners payload 的
  `pod` 字段，缺席视为 solo）。observer 未升级时该区显示降级提示（与 missions 段同款）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fleet-observability`: 新增要求——board 携带 cell 短期执行段（cells/shortterm；白名单收
  cell_stats；不污染常驻口径）。
- `wanxing-web`: 新增要求——运维视图渲染统一舰队视图（短期执行区 + runner 密度徽标，降级
  开放）。

## Impact

- 代码：`services/fleet-observer/store.js`（白名单一行）、`services/fleet-observer/observer.js`
  （board 两段）、`wanxing-web/src/views/console/OpsView.jsx`（渲染）。
- 测试：`scripts/test-fleet-observer.mjs` 追加 cell_stats 摄取+board 合成用例。
- 部署：fleet-observer 与 wanxing-web 两条既有发布线；paas 侧 gateway 需配
  FLEET_INGEST_URL/TOKEN 才有数据流入（先后顺序：本仓先滚，paas 后开门）。
- 无 breaking：board 只增字段；老消费端（OpsView 旧版、paas fleet-scheduler 读板）不受影响。
