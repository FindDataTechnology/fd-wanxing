// Chat view (add-agent-chat-lane 5.1): the visitor conversation page at
// #/chat/<slug>. The login gate reuses the console's auth plumbing — the
// chat lane verifies the same tenant identity WITHOUT the console allowlist,
// so any registered account may chat. Conversation history lives in
// localStorage per agent (the server persists no content, by spec); when the
// lane answers allowance-exhausted the view offers the own-key bridge: a
// pasted sk- key turns subsequent turns into ordinary API-lane calls.
import { useEffect, useRef, useState } from "react";
import { loginLogto, useAuth } from "../auth.js";

const histKey = (slug) => `wx-chat-history:${slug}`;
const ctxKey = (slug) => `wx-chat-ctx:${slug}`;
const ownKeyKey = (slug) => `wx-chat-ownkey:${slug}`;
const HISTORY_CAP = 200;
const approxTurns = (min) => `约 ${Math.max(1, Math.round(min / 1.5))} 回合`;

const loadHist = (slug) => {
  try {
    return JSON.parse(localStorage.getItem(histKey(slug)) ?? "[]");
  } catch {
    return [];
  }
};
const saveHist = (slug, messages) => {
  localStorage.setItem(histKey(slug), JSON.stringify(messages.slice(-HISTORY_CAP)));
};
const ctxFor = (slug) => {
  let v = localStorage.getItem(ctxKey(slug));
  if (!v) {
    v = `wx:chat-${crypto.randomUUID()}`;
    localStorage.setItem(ctxKey(slug), v);
  }
  return v;
};

// Tolerant text extraction over an SSE frame's JSON-RPC document: the runner
// emits status/message/artifact results whose text parts live at different
// depths — walk the result tree and concatenate every text part in order.
const textOfFrame = (doc) => {
  const out = [];
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v.parts)) {
      for (const p of v.parts) if (typeof p?.text === "string" && p.text) out.push(p.text);
    }
    for (const k of Object.keys(v)) if (k !== "parts") walk(v[k]);
  };
  walk(doc?.result ?? doc);
  return out.join("");
};

export function ChatView({ focusSlug } = {}) {
  const auth = useAuth();
  const slug = focusSlug ?? "";
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState(null);
  const [messages, setMessages] = useState(() => (slug ? loadHist(slug) : []));
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [ownKey, setOwnKey] = useState(() => (slug ? localStorage.getItem(ownKeyKey(slug)) ?? "" : ""));
  const [keyDraft, setKeyDraft] = useState("");
  const [ownKeyMode, setOwnKeyMode] = useState(false);
  // 402 exhaustion is its own state — the agent stays OPEN (subsidy on), the
  // visitor is simply out of free allowance; rendering it as "not open"
  // would misname the situation and unmount the own-key bridge.
  const [exhausted, setExhausted] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    setMessages(loadHist(slug));
    setOwnKey(localStorage.getItem(ownKeyKey(slug)) ?? "");
    setOwnKeyMode(false);
  }, [slug]);

  const refreshStatus = () => {
    if (!slug) return;
    setStatusErr(null);
    const opts = auth.token ? { headers: { Authorization: `Bearer ${auth.token}` } } : {};
    fetch(`/api/wanxing/v1/chat/${encodeURIComponent(slug)}/status`, opts)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw Object.assign(new Error(d?.error?.code || `HTTP ${r.status}`), { status: r.status });
        }
        return r.json();
      })
      .then((d) => {
        setStatus(d);
        // A refilled lane (host pool added, new subsidy day) lifts exhaustion.
        if ((d.subsidyRemainingToday ?? 0) + (d.hostPoolRemaining ?? 0) > 0) setExhausted(false);
      })
      .catch((e) => setStatusErr(String(e?.message || e)));
  };
  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, auth.token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (!slug) {
    return <div className="text-sm text-slate-500">缺少 agent——从<a className="underline" href="#/catalog">目录</a>进入。</div>;
  }
  if (statusErr?.includes("AGENT_NOT_FOUND")) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">没有这个 agent</h1>
        <p className="text-sm text-slate-500">该 agent 不存在或未公开——回<a className="underline" href="#/catalog">目录</a>看看其他 agent。</p>
      </div>
    );
  }

  const agentName = status?.agent?.name ?? slug;
  const chatAble = status?.chatAble === true;
  const paused = status?.reason === "agent_paused";
  // Not-open = the agent itself has no lane for this visitor (subsidy off and
  // no pool). Exhausted = lanes exist but this visitor's allowance is spent —
  // the conversation stays mounted with the own-key bridge at hand.
  const blocked = !chatAble && !paused && !exhausted;

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setNotice("");
    const useKey = ownKeyMode && ownKey;
    const next = [...messages, { role: "user", text, at: Date.now() }];
    setMessages(next);
    saveHist(slug, next);
    setSending(true);
    const url = useKey ? `/api/wanxing/v1/a2a/${encodeURIComponent(slug)}` : `/api/wanxing/v1/chat/${encodeURIComponent(slug)}`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          Authorization: `Bearer ${useKey ? ownKey : auth.token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "message/stream",
          params: { message: { role: "user", parts: [{ kind: "text", text }], context_id: ctxFor(slug) } },
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const code = d?.error?.code ?? `HTTP ${r.status}`;
        if (code === "CHAT_ALLOWANCE_EXHAUSTED") {
          setExhausted(true);
          const exhausted = [...next, { role: "system", text: "免费额度已用完——可粘贴自己的调用键继续对话。", at: Date.now() }];
          setMessages(exhausted);
          saveHist(slug, exhausted);
          refreshStatus();
        } else {
          const failed = [...next, { role: "error", text: d?.error?.message || code, at: Date.now() }];
          setMessages(failed);
          saveHist(slug, failed);
          setNotice(code);
        }
        return;
      }
      // SSE: accumulate text deltas into one growing assistant bubble.
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let frameErr = false;
      const push = (text) => {
        setMessages((prev) => {
          const base = prev.at(-1)?.role === "assistant" ? prev.slice(0, -1) : prev;
          const out = [...base, { role: "assistant", text, at: Date.now() }];
          return out;
        });
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let doc = null;
          try {
            doc = JSON.parse(payload);
          } catch {
            continue;
          }
          if (doc?.error) frameErr = true;
          const t = textOfFrame(doc);
          if (t && t !== acc) {
            acc = t;
            push(acc);
          }
        }
      }
      const finalBase = () =>
        setMessages((prev) => {
          const base = prev.at(-1)?.role === "assistant" ? prev : [...prev, { role: "assistant", text: acc || "（无输出）", at: Date.now() }];
          saveHist(slug, base);
          return base;
        });
      finalBase();
      if (frameErr) setNotice("本回合以错误告终——详见上方消息。");
      refreshStatus();
    } catch (e) {
      setNotice(String(e?.message || e));
    } finally {
      setSending(false);
    }
  };

  const applyOwnKey = () => {
    const k = keyDraft.trim();
    if (!/^sk-/.test(k)) {
      setNotice("调用键以 sk- 开头");
      return;
    }
    localStorage.setItem(ownKeyKey(slug), k);
    setOwnKey(k);
    setOwnKeyMode(true);
    setKeyDraft("");
    setNotice("已启用你自己的调用键——后续回合按 API 车道计费。");
  };
  const dropOwnKey = () => {
    localStorage.removeItem(ownKeyKey(slug));
    setOwnKey("");
    setOwnKeyMode(false);
    refreshStatus();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">与 {agentName} 对话</h1>
        <code className="text-xs text-slate-400 truncate" title={slug}>{slug}</code>
        {status?.agent?.description && <span className="text-sm text-slate-500 basis-full">{status.agent.description}</span>}
      </div>

      {!auth.token ? (
        <div className="max-w-sm mx-auto mt-10 space-y-3 text-center">
          <p className="text-sm text-slate-500">登录后即可与 agent 对话（每日有免费额度）。</p>
          <button
            onClick={() =>
              loginLogto({ gate: "chat", returnTo: `#/chat/${encodeURIComponent(slug)}` }).catch((e) =>
                alert(String(e?.message || e)),
              )
            }
            className="w-full px-3 py-2.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm"
          >
            使用寻数账号登录（Logto）
          </button>
        </div>
      ) : statusErr ? (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm">
          状态读取失败（{statusErr}）——请稍后再试。
        </div>
      ) : !status ? (
        <div className="text-sm text-slate-500">加载中…</div>
      ) : paused ? (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm">
          该 agent 已暂停，暂不可对话。
        </div>
      ) : blocked ? (
        <div className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-3 text-sm">
          该 agent 未开放对话——主人未配置额度{status.subsidy === "off" ? "，且平台补贴未开启" : ""}。可以直接用<a className="underline" href="#/docs">自己的调用键</a>经 API 车道调用。
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>
              今日免费额度剩余 <b>{status.subsidyRemainingToday ?? 0}</b> 分钟（{approxTurns(status.subsidyRemainingToday ?? 0)}）
            </span>
            <span>
              主人池剩余 <b>{status.hostPoolRemaining ?? 0}</b> 分钟
            </span>
            {ownKeyMode ? (
              <button onClick={dropOwnKey} className="underline hover:text-slate-900 dark:hover:text-slate-100">
                已用自己的键（点此切回免费额度）
              </button>
            ) : (
              ownKey && (
                <button onClick={() => setOwnKeyMode(true)} className="underline hover:text-slate-900 dark:hover:text-slate-100">
                  用自己的键继续
                </button>
              )
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 h-[50vh] overflow-y-auto space-y-2 text-sm">
            {messages.length === 0 && <div className="text-slate-400">开始你的第一句——历史只保存在本机浏览器。</div>}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-3 py-2 whitespace-pre-wrap"
                    : m.role === "error"
                      ? "max-w-[85%] rounded-lg border border-amber-400 text-amber-700 dark:text-amber-300 px-3 py-2"
                      : m.role === "system"
                        ? "mx-auto text-xs text-slate-400"
                        : "mr-auto max-w-[85%] rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 whitespace-pre-wrap"
                }
              >
                {m.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ownKeyMode ? `以你的调用键调用 ${agentName}…` : `向 ${agentName} 说点什么…`}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
            <button disabled={sending} className="px-4 py-2 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm disabled:opacity-40">
              {sending ? "回复中…" : "发送"}
            </button>
          </form>
          {notice && <div className="text-xs text-amber-600 dark:text-amber-400">{notice}</div>}

          {!ownKey && (
            <details className="text-xs text-slate-500" open={exhausted || undefined}>
              <summary className="cursor-pointer select-none">{exhausted ? "额度用完了——粘贴自己的调用键继续" : "额度用完了？粘贴自己的调用键继续"}</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  applyOwnKey();
                }}
                className="flex gap-2 pt-2"
              >
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="sk-…（只保存在本机浏览器）"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                />
                <button className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700">启用</button>
              </form>
            </details>
          )}
        </>
      )}
    </div>
  );
}
