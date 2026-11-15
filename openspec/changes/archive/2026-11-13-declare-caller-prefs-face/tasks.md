## 1. 契约

- [x] 1.1 `contracts/wanxing-public-api.v1.json` 新增 `$defs.prefsResponse`
      （`prefs.{callbackUrl,callbackSecretSet,reapMinutes}`，`additionalProperties:false`）
- [x] 1.2 `x-contract-rev` 2 → 3（登记新消费者属"形状集变大"，按 requirement 自己的升号规则）
- [x] 1.3 描述里写明：调用键即凭证、密钥只报存在不回显、GET 与 PUT 同形状

## 2. 判据

- [x] 2.1 `scripts/test-public-contract.mjs` 新增用例，按生产同一装配调用
      `registerPrefsRoutes(app, { core, store })`；用 stub sub2api 让 `sk-good` 通过
      `core.authenticate`
- [x] 2.2 GET 空态、PUT 设值两侧各验 `contract.check("prefsResponse", …)` 与
      `contract.coverage`；并断言 `JSON.stringify(body)` 不含密钥明文
- [x] 2.3 判据被证明会红（两次注入，均先看到报错原文再还原，`git status` 零改动）：
      ① 契约里 `callbackSecretSet` 改名 → 红 `$.prefs.callbackSecretSetX: required field missing`；
      ② `shapeOut` 多回显 `callbackSecret` → 红 `GET prefs emits undeclared fields`

## 3. 跨仓（rev 3 是硬钉）

- [x] 3.1 `paas/facet/contract/wanxing-public-api.v1.json` 逐字节同步；消费者测试里钉的
      rev 字面量 2 → 3（`scripts/test-wanxing-contract-consumer.mjs`）
- [x] 3.2 `fd-wire/api/tests/contracts/wanxing-public-api.v1.json` 逐字节同步
      （`test_the_vendored_contract_matches_the_owner_when_the_sibling_is_reachable` 兜底）

## 4. 归档

- [x] 4.1 `openspec validate declare-caller-prefs-face --strict` 通过后归档，
      并复验 `wanxing-borrowed-contracts` strict
- [x] 4.2 `npm test` 全绿（310 = 309 + 本条）
