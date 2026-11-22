# Tasks

## 1. 事实表

- [x] 1.1 `status-facts.js` 优先级链：「在役」提到「尚无调用」之前，`health=silent` 只在台账也说零时
      说话。验证：`factOf({status:"serving",health:{health:"silent"}})` 返回 `live`。
- [x] 1.2 保留 `stalled` 原位与 `unknown` / `failing` / `degraded` 不动。验证：既有断言全绿。

## 2. 断言

- [x] 2.1 新增红测：`serving + silent` 必须判 `live`（修复前失败，修复后通过）。
      验证：`node --test test/status-facts.test.mjs`。
- [x] 2.2 改掉把旧行为写成规格的那条：`views.test.jsx` 的
      `statusBadgeFor({status:"serving",health:{health:"silent"}})` 由「尚无调用」改为「在役」，
      并附注释说明为什么这不是回归。
- [x] 2.3 守住另一半：`idle + silent` 仍是「尚无调用」。验证：新增断言。

## 3. 收口

- [x] 3.1 `wanxing-web` 132/132、`fd-wanxing` 382/382 全绿。
- [x] 3.2 出片上产后在控制台核对「寻数分身」那张卡：徽标应为「在役」，与下一行 9 回合一致。

## Workflow follow-up

- 归档时用 `openspec archive ledger-outranks-silence`（delta 含 MODIFIED 块，整块替换需要 CLI 自己合并）。

  **验收记录（2026-11-22，生产 sha-0cd3ff8）**：`寻数分身` 卡徽标「在役」、结论
  「近 7 天 9 回合，无健康告警」、数字 9，三者一致（修复前徽标写「尚无调用」）。

## 4. 同源发现的另一处（不在本 change 的判定范围内）

- [x] 4.1 `策略工坊助手` 徽标「尚无调用」但同卡「近 30 天结算 $0.10」。查台账：调用在
      2026-11-07，距今 15 天——7 天窗零回合、30 天窗有 1 分钟，两个数都对，只是窗口不同。
      判定逻辑无需改；改了结论句措辞「尚无调用 → 近 7 天无调用」（提交 03a262a）。
- [x] 4.2 核实 `turns7d` 含失败回合（SQL 只按 started_at 计数，不看 outcome）。spec 把它定义为
      「台账的 external turns」——数的是调用次数不是成功次数，符合规格，**不改**。
      失败/成功分解在「记录」面板的 activity[] 里。
