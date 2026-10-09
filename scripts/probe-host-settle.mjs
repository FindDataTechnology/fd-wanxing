#!/usr/bin/env node
// probe-host-settle — add-agent-chat-lane 1.2: exercise the packs internal
// host-settle contract against a live/staging packs surface with a real
// sub2api behind it. Two identical calls: the first must deduct once, the
// second must answer duplicate without a second deduction.
//
//   PACKS_BASE=https://… PACKS_TOKEN=runner-… PACK_ID=… AGENT_ID=… \
//   RATE=0.1 MINUTES=1 node scripts/probe-host-settle.mjs
//
// Reads the deployer's before/after balance through the billing board when
// BOARD_URL/BOARD_TOKEN are also provided; without them it asserts on the
// endpoint's own responses (settled/duplicate) only.

const base = String(process.env.PACKS_BASE || "").replace(/\/+$/, "");
const token = process.env.PACKS_TOKEN || "";
const packId = process.env.PACK_ID || "";
const agentId = process.env.AGENT_ID || "";
const minutes = Number(process.env.MINUTES || 1);
const rate = Number(process.env.RATE || 0.1);

if (!base || !token || !packId || !agentId) {
  console.error("PACKS_BASE, PACKS_TOKEN, PACK_ID, AGENT_ID are required");
  process.exit(2);
}

const usageId = `probe_${Date.now().toString(36)}`;
const path = `/api/packs/internal/deployments/${encodeURIComponent(packId)}/${encodeURIComponent(agentId)}/host-settle`;

const call = async () => {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ usage_id: usageId, minutes, rate_usd_per_min: rate }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const boardBalance = async () => {
  const url = process.env.BOARD_URL;
  const tok = process.env.BOARD_TOKEN;
  if (!url || !tok) return null;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
    const doc = await r.json();
    const row = (doc?.keys ?? []).find((k) => k.packId === packId && k.agentId === agentId);
    return row?.balance ?? null;
  } catch {
    return null;
  }
};

const main = async () => {
  const before = await boardBalance();
  const first = await call();
  const second = await call();
  const after = await boardBalance();

  console.log(`first : ${first.status} ${JSON.stringify(first.body)}`);
  console.log(`second: ${second.status} ${JSON.stringify(second.body)}`);
  if (before != null && after != null) console.log(`balance: ${before} -> ${after} (expect -${(minutes * rate).toFixed(4)})`);

  const fail = [];
  if (first.status !== 200 || first.body?.settled !== true || first.body?.duplicate !== false) fail.push("first call must settle");
  if (second.status !== 200 || second.body?.duplicate !== true) fail.push("second call must answer duplicate");
  if (before != null && after != null && Math.abs(before - after - minutes * rate) > 1e-6) fail.push("balance delta mismatch");

  if (fail.length) {
    console.error(`FAIL: ${fail.join("; ")}`);
    process.exit(1);
  }
  console.log("PASS: host-settle deducts exactly once, replay is a duplicate");
};

main();
