// status-facts 单测：七种事实 + 优先级冲突组合。
// 这是 unify-wanxing-surface-language 的核心判据——「一枚主徽标」由这里保证。
import { test } from "node:test";
import assert from "node:assert/strict";
import { factOf, badgeFor, factLabel, isHealthy, FACT_ORDER } from "../src/status-facts.js";

test("七种事实各自可判定", () => {
  assert.equal(factOf({ status: "paused" }), "paused");
  assert.equal(factOf({ status: "unknown" }), "unknown");
  assert.equal(factOf({ status: "serving", health: { health: "failing" } }), "failing");
  assert.equal(factOf({ status: "serving", health: { health: "degraded" } }), "degraded");
  assert.equal(factOf({ status: "idle", health: { health: "silent", stalled: true } }), "stalled");
  assert.equal(factOf({ status: "idle", health: { health: "silent" } }), "unused");
  assert.equal(factOf({ status: "serving", health: { health: "ok" } }), "live");
});

test("优先级冲突：暂停压过故障，未知压过故障", () => {
  assert.equal(factOf({ status: "paused", health: { health: "failing" } }), "paused");
  assert.equal(factOf({ status: "unknown", health: { health: "failing" } }), "unknown");
});

test("failing + serving 只返回一枚事实，且措辞不含健康类词", () => {
  const fact = factOf({ status: "serving", health: { health: "failing" } });
  assert.equal(fact, "failing");
  const badge = badgeFor(fact);
  assert.equal(badge.label, "持续失败");
  for (const word of ["运行中", "在役", "空闲"]) {
    assert.ok(!badge.label.includes(word), `一枚主徽标不得掺入健康措辞：${word}`);
  }
});

test("该跑没跑 与 尚无调用 是两件事", () => {
  assert.notEqual(
    factOf({ status: "idle", health: { health: "silent", stalled: true } }),
    factOf({ status: "idle", health: { health: "silent" } }),
  );
});

test("观测面整段不可用时不冒充未知，回落到 status", () => {
  assert.equal(factOf({ status: "serving", health: null, healthSectionUp: false }), "live");
  assert.equal(factOf({ status: "idle", health: null, healthSectionUp: false }), "unused");
});

test("观测面段可用但本 agent 缺席 -> 状态未知", () => {
  assert.equal(factOf({ status: "serving", health: null, healthSectionUp: true }), "unknown");
});

test("serving/idle 的措辞不读作进程在跑/待命", () => {
  for (const fact of ["unused", "live"]) {
    const label = factLabel(fact);
    assert.ok(!label.includes("运行中"), `${fact} 不得读作「运行中」`);
    assert.ok(!label.includes("空闲"), `${fact} 不得读作「空闲待命」`);
  }
});

test("意外的 status 值落到状态未知，不落到健康", () => {
  assert.equal(factOf({ status: "banana" }), "unknown");
  assert.equal(factOf({}), "unknown");
});

test("badgeFor 对未知事实 fail-closed 到状态未知", () => {
  assert.equal(badgeFor("nonsense").fact, "unknown");
  assert.equal(badgeFor("nonsense").label, "状态未知");
});

test("isHealthy 只认在役", () => {
  assert.equal(isHealthy("live"), true);
  for (const f of FACT_ORDER.filter((x) => x !== "live")) assert.equal(isHealthy(f), false);
});

test("FACT_ORDER 是 D1 的七条链且无重复", () => {
  assert.equal(FACT_ORDER.length, 7);
  assert.equal(new Set(FACT_ORDER).size, 7);
  assert.deepEqual(FACT_ORDER, ["paused", "unknown", "failing", "degraded", "stalled", "unused", "live"]);
});

// 2026-11-22 实撞（控制台「寻数分身」卡）：同一张卡里徽标写「尚无调用」，
// 下一行写「近 7 天回合 9」。根因是 factOf 的优先级链：观测面的 silent 压过
// 了计费台账的 turns7d，而两者是同一个事实的两种来源。
//
// 判据：turns7d 是账读出来的硬数字，silent 是观测采样得出的推断。硬数字该赢。
test("serving + silent 不能判成尚无调用——台账有回合就是有回合", () => {
  assert.equal(
    factOf({ status: "serving", health: { health: "silent" } }),
    "live",
    "有回合数(a serving)时，观测面静默不得把主徽标改写成「尚无调用」",
  );
});

test("idle + silent 仍然是尚无调用——两边都说零", () => {
  assert.equal(factOf({ status: "idle", health: { health: "silent" } }), "unused");
});
