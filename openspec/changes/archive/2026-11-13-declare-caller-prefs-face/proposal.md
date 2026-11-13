# declare-caller-prefs-face

## Why

2026-11-13 扫「还有哪个公开面被兄弟线读却没登记」时撞出来的：谦面 CLI 的 `facet prefs`
子命令（`paas/facet/cli/facet.js`）在读 `GET`/`PUT /api/wanxing/v1/prefs/{slug}`，读的是
`prefs.callbackUrl` / `prefs.callbackSecretSet` / `prefs.reapMinutes` 三个键——而这个面在
`contracts/wanxing-public-api.v1.json` 里**一个字都没有**。

也就是说：消费方按一份口口相传的形状写死，我方把 `callbackSecretSet` 改个名，消费方只会在
运行时拿到 `undefined`，页面/CLI 显示成"未设"，既不报错也不红。这正是
「借用边界的入向消费者同属契约」要收的那一类，只是当时那张表只列了 5 个面 + 宿主协议。

顺带核过方法：CLI 用的是 `PUT`（不是 PATCH），与路由一致；响应读 `.prefs`，也与路由一致。
所以消费方没错，错在契约漏登记。

## What Changes

- `$defs.prefsResponse`：`{prefs: {callbackUrl: string|null, callbackSecretSet: boolean,
  reapMinutes: integer|null}}`，`additionalProperties: false`；描述里写明调用键即凭证、
  密钥只报存在不回显。
- `x-contract-rev` 2 → 3：登记一行新消费者属于"形状集变大"，按本条 requirement 自己的
  「新增跨仓消费者 → 修订号随之升号」办；升号迫使两侧副本重新确认（vendored 副本要逐字节同步）。
- `test-public-contract.mjs` 新增判据：驱动真 `registerPrefsRoutes`（与生产同一装配），
  GET/PUT 两侧各验 `check` + `coverage`，并硬断言密钥值永不出现在响应里。
- spec 的入向消费者表加一行，并把 `prefs` 面写进该 requirement 的面枚举。

## Impact

- 受影响能力：`wanxing-borrowed-contracts`（MODIFIED 一条既有 requirement，不改 scenario 名）。
- 受影响仓：`fd-wanxing`（契约 + 判据）；`paas`（vendored 副本 rev 3 + 消费者钉的字面量）；
  `fd-wire`（vendored 副本 rev 3，`api/tests/contracts/`）。
- 零运行时行为变化：契约是描述，判据是测试。
