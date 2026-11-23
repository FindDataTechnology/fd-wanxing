#!/usr/bin/env node
// ── 声明的形状必须能被发端真正观测到 ──────────────────────────────────────
//
// `test-public-contract.mjs` 的覆盖判据只走一个方向：**发出去的键必须在契约里具名**。
// 反过来那一半没人管——契约里写了一个发端从来不发的键，照样全绿，等到消费方按契约
// 去读才变成"整段 undefined"，症状与"空挂载"完全同形。
//
// 2026-11-13 实撞：`fleetBoardResponse.runner_liveness` 的条目被写成
// `{state, seen_at}`，`agent_health` 的条目被写成 `{health, stalled, silent_ms,
// reason}`；线上真实发的是 `{last_seen_at, age_ms, beats, presence}` 与
// `{since, consecutive, consecutiveHours, turns, errors, lastErrorKind, stale, …}`。
// 两个名字都对不上，而当时所有判据都是绿的——因为没有任何一条判据去对齐发端。
//
// 这条测试就是那一半：把 observer 真跑起来、拿一份布满数据的 board，逐段比对
// 「契约声明的键」与「发端实际发出的键」。三个集合：
//   emitted − declared  → 红（发端偷偷扩了面，覆盖判据那边也该红，这里是第二道）
//   declared − emitted − CONDITIONAL → 红（契约写了一个不存在的键）
// CONDITIONAL 是显式白名单，必须写清"什么条件下才出现"，不许凭空豁免。
//
//   node --test scripts/test-board-contract-shape.mjs

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { test } from "node:test";

const { createObserver } = await import("../services/fleet-observer/observer.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(
  readFileSync(path.join(here, "..", "contracts", "wanxing-public-api.v1.json"), "utf8"),
);
const boardSchema = contract.$defs.fleetBoardResponse;

const TOKEN = "obs-contract-shape";
const HOUR = 3_600_000;
const BASE = Date.parse("2026-11-13T04:00:00Z");

//: 只在特定条件下才出现的声明键。豁免必须带条件，否则等于把判据关掉。
const CONDITIONAL = new Map([
  ["agent_health.declared_every_ms", "只有声明了节奏的 agent 才有"],
  ["agent_health.expected_turns", "只有声明了节奏的 agent 才有"],
  ["agent_health.stalled", "只有声明了节奏且零回合时才出现"],
]);

const tmp = mkdtempSync(path.join(tmpdir(), "wx-shape-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

/** 起一个真 observer（真 sqlite、真路由），喂满每一段的数据。 */
async function harness() {
  const dataRoot = mkdtempSync(path.join(tmp, "s-"));
  const clock = { value: BASE };
  const observer = createObserver({
    dataRoot, ingestToken: TOKEN, now: () => clock.value, log: () => {},
  });
  const server = http.createServer(observer.app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const ingest = (events) =>
    fetch(`${base}/ingest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    }).then((r) => r.json().catch(() => null));

  const mk = (agent, kind, ts, payload = {}, runner = "runner-a") => ({
    id: `e-${agent}-${kind}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    source: "runner", agent, runner, kind, ts, payload,
  });

  // 让每一段都有内容：回合（喂 agent_health / turns）、runner_stats（喂
  // runner_liveness / runners）、租约三种 kind（喂 leases 与其 units 内层）、
  // 结算与唤醒（喂 wake_ms / settled_pending）、cell_stats（喂 cells/shortterm）。
  await ingest([
    mk("packs-a-agent", "turn_ended", BASE - 3 * HOUR, { outcome: "ok" }),
    mk("packs-a-agent", "turn_ended", BASE - 2 * HOUR, { outcome: "ok" }),
    mk("packs-b-agent", "turn_ended", BASE - 2 * HOUR, { outcome: "error" }),
    mk("packs-b-agent", "turn_ended", BASE - 1 * HOUR, { outcome: "error" }),
    mk("packs-b-agent", "turn_ended", BASE - 1 * HOUR, { outcome: "error" }),
    mk("packs-c-agent", "state_changed", BASE - 5000, { from: "warm", to: "paused" }),
    mk("packs-a-agent", "runner_stats", BASE - 1000, { budget_mb: 300, budget_mb_limit: 512, children: 2 }),
    mk("packs-a-agent", "turn_started", BASE - 900, { wake_ms: 700 }),
    mk("packs-a-agent", "settled", BASE - 800, { settlement_status: "pending", usd: 1.25, minutes_billed: 2 }),
    // 租约三态：claimed / renewed / expired — units 内层要有内容才比得到键
    mk("packs-a-agent", "lease.claimed", BASE - 700, { unit: "work-1", holder: "wu-1", attempt: 1 }),
    mk("packs-a-agent", "lease.renewed", BASE - 600, { unit: "work-1", holder: "wu-1", attempt: 2 }),
    mk("packs-a-agent", "lease.expired", BASE - 500, { unit: "work-2", holder: "wu-2", attempt: 1 }),
    {
      id: `cell-${BASE}`, source: "cell", agent: "cell:边缘节点", kind: "cell_stats", ts: BASE - 400,
      payload: { executions: 3, workers: 4, jobs: 1, agentBusy: 2 },
    },
  ]);

  // rollup/health 是定时器驱动的，测试里手动推一次，不依赖墙钟。
  observer.rollupPass();
  observer.evaluateHealth();
  clock.value = BASE + 1000;

  const board = await (await fetch(`${base}/api/fleet/v1/board`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })).json();

  return { board, close: () => new Promise((r) => server.close(r)) };
}

const declaredKeys = (node) => Object.keys(node?.properties ?? {});
const firstOf = (v) => (Array.isArray(v) ? v[0] : Object.values(v ?? {})[0]);

test("board: every declared item key is actually emitted (the other half of the contract judge)", async () => {
  const { board, close } = await harness();
  try {
    // 段 → (契约条目 schema, 线上条目样本)
    const segments = [
      ["runner_liveness", boardSchema.properties.runner_liveness.additionalProperties,
        firstOf(board.runner_liveness)],
      ["leases.units", boardSchema.properties.leases.properties.units.items,
        firstOf(board.leases.units)],
      ["agent_health", boardSchema.properties.agent_health.items, firstOf(board.agent_health)],
    ];

    const problems = [];
    for (const [name, schema, sample] of segments) {
      assert.ok(sample && typeof sample === "object",
        `${name}: 夹具没能产出条目，判据等于没跑（先修夹具，别修断言）`);
      const declared = declaredKeys(schema);
      const emitted = Object.keys(sample);
      const missing = declared.filter((k) => !emitted.includes(k) && !CONDITIONAL.has(`${name}.${k}`));
      const extra = emitted.filter((k) => !declared.includes(k));
      if (missing.length) problems.push(`${name}: 契约声明但发端从不发 → ${missing.join(", ")}`);
      if (extra.length) problems.push(`${name}: 发端发了但契约没声明 → ${extra.join(", ")}`);
    }

    assert.deepEqual(problems, [], `契约与发端不一致：\n  ${problems.join("\n  ")}`);
  } finally {
    await close();
  }
});
