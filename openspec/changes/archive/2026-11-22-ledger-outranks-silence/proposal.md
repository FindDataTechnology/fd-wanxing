# Proposal

## Why

舰队卡上出现自相矛盾的一枚徽标与一行数字（2026-11-22 控制台实撞，「寻数分身」那张卡）：

```
[尚无调用]  寻数分身
尚无调用
近 7 天回合   9        近 30 天分钟  19      近 30 天结算  $1.90
```

同一张卡、同一次渲染，徽标说零回合，下一行说 9 回合。根因是 `status-facts.js` 的优先级链把
观测面的 `health=silent` 排在门面 `status=serving` 之前——而这两者是**同一个事实的两种来源**：

- `serving` 按该文件自己的定义是「近 7 天有人调用」，读数来自计费台账；
- `silent` 是观测面采样得出的推断。

让推断压过台账，等于让较弱证据覆盖较强证据，结果是「有调用」被说成「尚无调用」。

## What Changes

- 优先级链中把「在役」提到「尚无调用」之前：`status=serving` 或 `health=ok` 命中「在役」，
  不再被 `health=silent` 改写成「尚无调用」。
- `health=silent` 仍然说话——但只在台账也说零（`status=idle`）时，此时「尚无调用」不变。
- 「该跑没跑」（silent + stalled）的优先级不动：它说的是「声明了节奏却一次没跑」，与「有回合」互斥。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-web`: 「One status fact, one badge, across every surface」的优先级表第 6/7 行互换，
  并补一条场景钉住「serving + silent 不得判成尚无调用」。

## Non-goals

- 不动门面 `/api/wanxing/v1/agents` 的字段与取值（这条规格本来就只约束消费侧）。
- 不动「该跑没跑」的判定。
- 不引入「冲突时显式报错」的第三种状态——那会让每一张卡都可能变成告警，代价大于收益。

## Impact

- `wanxing-web/src/status-facts.js` — 两条 `if` 换位。
- `wanxing-web/test/status-facts.test.mjs` — 新增 1 条；`views.test.jsx` 改 1 条（该条把旧行为
  写成了规格：`serving + silent → 尚无调用`）。
- 四个消费面（目录 / 详情 / 舰队卡 / 运维面）同时生效，因为都走这张表。