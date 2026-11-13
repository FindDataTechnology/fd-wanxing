## 1. 判据（已落）

- [x] 1.1 新增 `scripts/test-board-contract-shape.mjs`：起真的 observer（真 sqlite + 真路由），
      喂 turns / runner_stats / lease.claimed|renewed|expired / cell_stats / settled，对
      `runner_liveness`、`leases.units`、`agent_health` 三面做「声明键集 ↔ 实发键集」双向比对，
      条件键走显式豁免表。验证：`node --test scripts/test-board-contract-shape.mjs` 绿
- [x] 1.2 判据能被证明会红（三次）：① 把 `runner_liveness` 的内层声明退回 `{state, seen_at}`
      → 红并点名 `last_seen_at`；② 删掉 `agent_health` 的 `window_hours` → 覆盖方向红并点名；
      ③ 在豁免表里塞一个不存在的键 → 红。三次都先看到报错原文才改回
- [x] 1.3 判据由 `npm test` 覆盖：`package.json` 的 `test` 脚本为
      `scripts/test-*.mjs` 通配，无需单列。验证：`npm test` 308 passed

## 2. 契约订正（rev 1 → 2）

- [x] 2.1 `contracts/wanxing-public-api.v1.json`：`runner_liveness.additionalProperties` 改为
      `{last_seen_at, age_ms, beats, presence}`（`presence` 为 `ok|stale|lost` 枚举）
- [x] 2.2 同文件：`agent_health.items.properties` 改为
      `{agent, health, since, consecutive, consecutiveHours, turns, errors, lastErrorKind,
      stale, window_hours, declared_every_ms, expected_turns, stalled}`；后三个进条件键豁免表
- [x] 2.3 `x-contract-rev` 1 → 2。验证：`node scripts/test-public-contract.mjs` 绿；
      表审计旧口径（读 change 目录）改为读主 spec，且判据补收 `enum` 值

## 3. 跨仓同步（rev 2 是硬钉）

- [x] 3.1 `wanxing-ops-mcp/tests/test_contract_shape.py`：`FLEET_BOARD_FIELDS` 20 键、
      `FLEET_LIVENESS_FIELDS` 4 键、`FLEET_AGENT_HEALTH_FIELDS` 13 键（含 3 个条件键）+ 夹具。
      验证：65 passed
- [x] 3.2 `paas/facet/contract/wanxing-public-api.v1.json` 逐字节同步 + 消费者钉住的
      rev 字面量改为 `"2"`。验证：`node scripts/test-wanxing-contract-consumer.mjs` 绿；
      根层契约漂移脚本 OK
- [x] 3.3 `fd-wire/api/tests/contracts/wanxing-public-api.v1.json` 逐字节副本 +
      可达时断言与 owner 逐字节相同。验证：单仓模拟 17 passed

## 4. 归档

- [x] 4.1 `openspec validate require-contract-observability --strict` 通过后归档；
      归档后对 `wanxing-borrowed-contracts` 复跑一次 strict
