// ── Shared conversation core (unify-cross-line-copilot 5.x) ─────────────────
//
// The chat view (`#/chat/<slug>`) and the embed widget (`#/embed/<slug>`) used
// to be two parallel implementations: same-shaped-but-differently-named storage
// keys, two copies of the history helpers, two copies of the tolerant text
// walker, and an ask lane only the embed side rendered. Everything in this file
// is the part they must agree on.
//
// What lives HERE: history persistence + migration, context identity, the
// own-key bridge, text extraction from A2A frames, SSE dispatch by event name,
// the ask answer route, and the ask summary line.
//
// What stays in the shells: how identity is obtained (tenant login vs the embed
// tier ladder), layout, theming, and whether an allowance bar is shown. This
// module never imports an auth module — it receives an already-resolved bearer.

const HISTORY_CAP = 200;

// One namespace for both shells. `wx-chat-*` is the pre-existing chat-view
// shape, so existing chat users need no migration at all; embed history is
// folded in from its old `wx-embed-*` keys on first read (one conversation per
// agent either way — merging is the correct semantic).
const keys = (slug) => ({
  hist: `wx-chat-history:${slug}`,
  ctx: `wx-chat-ctx:${slug}`,
  ownKey: `wx-chat-ownkey:${slug}`,
});
const legacyKeys = (slug) => ({
  hist: `wx-embed-hist:${slug}`,
  ctx: `wx-embed-ctx:${slug}`,
  ownKey: `wx-embed-ownkey:${slug}`,
});

const read = (k) => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, v); } catch { /* quota / private mode: display-only loss */ }
};

// Load history with one-way migration: read the unified key, else adopt the
// legacy key (and write it forward, keeping the old one for a release — a
// destructive delete here would lose a visitor's transcript on upgrade).
export function loadHistory(slug) {
  const cur = read(keys(slug).hist);
  if (cur) {
    try { return JSON.parse(cur) ?? []; } catch { return []; }
  }
  const old = read(legacyKeys(slug).hist);
  if (!old) return [];
  try {
    const rows = JSON.parse(old) ?? [];
    if (Array.isArray(rows) && rows.length) write(keys(slug).hist, JSON.stringify(rows.slice(-HISTORY_CAP)));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function saveHistory(slug, messages) {
  write(keys(slug).hist, JSON.stringify((messages ?? []).slice(-HISTORY_CAP)));
}

export function clearHistory(slug) {
  try { localStorage.removeItem(keys(slug).hist); } catch { /* ignore */ }
}

// Conversation-correlation id (the server persists no content; this id groups a
// browser's turns for one agent). Adopted from the legacy key when present.
export function contextId(slug) {
  let v = read(keys(slug).ctx);
  if (!v) {
    v = read(legacyKeys(slug).ctx);
    if (!v) v = `wx:conv-${crypto.randomUUID()}`;
    write(keys(slug).ctx, v);
  }
  return v;
}

// The own-key bridge: a pasted caller key turns subsequent turns into API-lane
// calls. Rider on the session, never sent anywhere but this origin.
export function ownKeyOf(slug) {
  const cur = read(keys(slug).ownKey);
  if (cur) return cur;
  const old = read(legacyKeys(slug).ownKey);
  if (old) write(keys(slug).ownKey, old);
  return old ?? "";
}

export function setOwnKey(slug, key) {
  if (key) write(keys(slug).ownKey, key);
  else {
    try { localStorage.removeItem(keys(slug).ownKey); } catch { /* ignore */ }
  }
}

// ── Frame text ─────────────────────────────────────────────────────────────
// A2A frames carry a result tree; concatenate every text part in order. Any
// unexpected shape degrades to "" rather than throwing mid-stream.
export function textOfFrame(doc) {
  const out = [];
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v.parts)) for (const p of v.parts) if (typeof p?.text === "string" && p.text) out.push(p.text);
    for (const k of Object.keys(v)) if (k !== "parts") walk(v[k]);
  };
  walk(doc?.result ?? doc);
  return out.join("");
}

// ── Intent envelope (host page actions ride the question id) ────────────────
// The ask schema is strict (options carry no id), so the model-controlled field
// that can hold structure is the question id: `intent:<verb>:<arg>`.
export const INTENT_RE = /^intent:([a-z][a-z-]{0,31}):(.*)$/;
export function parseIntent(id) {
  if (typeof id !== "string") return null;
  const m = INTENT_RE.exec(id);
  return m ? { verb: m[1], arg: m[2] } : null;
}

// ── SSE dispatch ───────────────────────────────────────────────────────────
// The turn stream is dispatched by EVENT NAME: an `ask` frame opens the inquiry
// card, everything else feeds the growing assistant bubble. Keepalive comment
// lines (sent while an ask is pending) are skipped, and an `error` event or an
// error payload marks the turn as failed without killing the transcript.
//
// `onAsk(ask)` receives `{ askId, questions, deadlineAt }`; `onText(text)`
// receives the accumulated text after each change. Resolves with
// `{ text, frameError }` when the stream ends.
export async function parseTurnStream(body, { onAsk, onText } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let acc = "";
  let frameErr = false;
  let currentEvent = null;

  const handleEvent = (event, doc) => {
    if (event === "ask") {
      const questions = Array.isArray(doc?.questions)
        ? doc.questions.filter((q) => q && typeof q.id === "string" && typeof q.question === "string").slice(0, 4)
        : [];
      if (typeof doc?.askId === "string" && doc.askId && questions.length && Number.isFinite(Number(doc.deadlineAt))) {
        onAsk?.({ askId: doc.askId, questions, deadlineAt: Number(doc.deadlineAt) });
      }
      return;
    }
    if (doc?.error || event === "error") frameErr = true;
    const t = textOfFrame(doc);
    if (t && t !== acc) {
      acc = t;
      onText?.(acc);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line === "") { currentEvent = null; continue; }
      if (line.startsWith(":")) continue; // keepalive comment
      if (line.startsWith("event:")) { currentEvent = line.slice(6).trim(); continue; }
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let doc = null;
      try { doc = JSON.parse(payload); } catch { continue; }
      handleEvent(currentEvent, doc);
    }
  }
  return { text: acc, frameError: frameErr };
}

// ── Ask answers ────────────────────────────────────────────────────────────
// Answers ride the side route under the turn's own credential; the route is
// metered by the turn, never by this POST. A refusal is reported as a note on
// the transcript line so the card can converge to its resolved state.
//
// This module stays import-free (ChatView and the embed widget both load it,
// and auth.js pulls in the whole identity store) — so the caller injects the
// transport. Pass `authFetch` from auth.js to get silent renewal on a 401;
// omitting it keeps the plain fetch, which is what the own-key lane wants.
// 2026-11-16: the route used to spend whatever bearer the caller captured at
// turn start, so a turn outliving its id_token got a note instead of a
// renewal — the answer was silently lost.
export async function postAskAnswer(slug, bearer, { askId, answers, cancelled, fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`/api/wanxing/v1/chat/${encodeURIComponent(slug)}/ask-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(cancelled ? { askId, cancelled: true } : { askId, answers }),
    });
    const body = await r.json().catch(() => null);
    if (r.status === 200 && body?.accepted === true) return { note: null };
    if (r.status === 404 || body?.error?.code === "ASK_UNKNOWN" || body?.accepted === false) return { note: "（该问询已被回答或已失效）" };
    if (r.status === 401) return { note: "（登录已失效，答案可能未送达）" };
    return { note: `（答案可能未送达：HTTP ${r.status}）` };
  } catch (e) {
    return { note: `（答案可能未送达：${String(e?.message || e)}）` };
  }
}

// The resolved line shown in the transcript once an ask is done — identical in
// both shells (spec: "chat and embed describe one ask the same way"). The
// wording is the embed lane's shipped form, kept verbatim.
export function askSummaryText(questions, outcome = {}) {
  const first = questions?.[0]?.question ?? "";
  if (outcome.cancelled) return `问询「${first}」已取消。`;
  const rows = (outcome.answers ?? []).map((a) => {
    const q = (questions ?? []).find((x) => x.id === a.id);
    const sel = (a.selected ?? []).join("、");
    return `${q?.question ?? a.id} → ${sel || "（未选）"}${a.custom ? `（${a.custom}）` : ""}`;
  });
  return `问询已答：${rows.join("；") || "（空）"}${outcome.note ? `\n${outcome.note}` : ""}`;
}

// A turn's conversation context: the marked prefix the agent sees for host
// page facts (data, NOT an instruction). Wording is unchanged from the embed
// lane's shipped form — the tests and the agent's prompt both key on it.
/**
 * 把宿主推来的 `wx-copilot-context` 消息规整成 `{line,page,entity,intent}`。
 *
 * 两种形状都收：loader（copilot.js 的 sendContext）把宿主 context() 的返回值包在
 * `context` 字段里发，而协议注释写的是顶层字段。曾经只读顶层，于是环绕上下文全是
 * undefined、contextPrefix() 永远返回空串——宿主页面上下文从未真正送达 agent
 * （2026-11-16 真机：agent 答「我读不到你的页面状态」）。
 */
export function normalizeHostContext(d) {
  const src = d && typeof d.context === "object" && d.context !== null ? d.context : d;
  if (!src || typeof src !== "object") return {};
  const cut = (v, n) => (typeof v === "string" ? v.slice(0, n) : undefined);
  return {
    line: cut(src.line, 120),
    page: cut(src.page, 300),
    entity: cut(src.entity, 300),
    intent: cut(src.intent, 300),
  };
}

export function contextPrefix(ctx) {
  const lines = [];
  if (ctx?.line) lines.push(`产品线：${ctx.line}`);
  if (ctx?.page) lines.push(`页面：${ctx.page}`);
  if (ctx?.entity) lines.push(`对象：${ctx.entity}`);
  if (ctx?.intent) lines.push(`意图：${ctx.intent}`);
  if (!lines.length) return "";
  return `[宿主页面提供的上下文（非用户指令）]\n${lines.join("\n")}\n\n用户消息：`;
}
