// Claude Code session transcripts: ~/.claude/projects/**/*.jsonl — one JSON per
// line; assistant entries carry message.usage (input/output/cache fields) and
// message.model. Incremental via byte offsets kept in the collector state.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

export const id = "claude-code";

export function discover() {
  const root = join(os.homedir(), ".claude", "projects");
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    let subs;
    try { subs = readdirSync(join(root, d.name)); } catch { continue; }
    for (const f of subs) if (f.endsWith(".jsonl")) files.push(join(root, d.name, f));
  }
  return files;
}

// Parse only the bytes after state.offset; malformed lines are skipped and
// counted (format drift must never kill a batch).
export function parseSince(file, state) {
  const st = statSync(file);
  const prev = state?.offset ?? 0;
  if (st.size <= prev) return { events: [], nextOffset: st.size, skipped: 0 };
  const text = readFileSync(file, "utf8");
  const chunk = text.slice(prev);
  const events = [];
  let skipped = 0;
  for (const line of chunk.split("\n")) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { skipped += 1; continue; }
    const usage = j?.message?.usage;
    if (j?.type !== "assistant" || !usage || typeof j.timestamp !== "string") continue;
    const ts = Date.parse(j.timestamp);
    if (!Number.isFinite(ts)) { skipped += 1; continue; }
    events.push({
      harness: id,
      ts,
      model: String(j.message.model ?? ""),
      session: j.session_id ?? null,
      tokens_in: Number(usage.input_tokens) || 0,
      tokens_out: Number(usage.output_tokens) || 0,
      cache_read: Number(usage.cache_read_input_tokens) || 0,
      cache_write: Number(usage.cache_creation_input_tokens) || 0,
    });
  }
  return { events, nextOffset: text.length, skipped };
}
