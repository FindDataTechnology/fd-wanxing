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
- [ ] 3.2 出片上产后在控制台核对「寻数分身」那张卡：徽标应为「在役」，与下一行 9 回合一致。

## Workflow follow-up

- 归档时用 `openspec archive ledger-outranks-silence`（delta 含 MODIFIED 块，整块替换需要 CLI 自己合并）。
