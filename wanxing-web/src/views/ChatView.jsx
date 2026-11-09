// Chat view (add-agent-chat-lane 5.1): the visitor conversation page at
// #/chat/<slug>. The login gate reuses the console's auth plumbing — the
// chat lane verifies the same tenant identity WITHOUT the console allowlist,
// so any registered account may chat. Conversation history lives in
// localStorage per agent (the server persists no content, by spec); when the
// lane answers allowance-exhausted the view offers the own-key bridge: a
// pasted sk- key turns subsequent turns into ordinary API-lane calls.
import { useEffect, useRef, useState } from "react";
import { authFetch, loginLogto, useAuth } from "../auth.js";
import { SkeletonLines } from "../components/Skeleton.jsx";
import { AskCard } from "../components/AskCard.jsx";
import {
  askSummaryText,
  clearHistory,
  contextId,
  loadHistory,
  ownKeyOf,
  parseTurnStream,
  postAskAnswer,
  saveHistory,
  setOwnKey as persistOwnKey,
} from "../chat-core.js";

// Conversation persistence, stream dispatch, and the ask lane are SHARED with
// the embed widget (chat-core.js) — this view keeps only its login shell, its
// allowance bar, and the own-key bridge UI.
const loadHist = (slug) => loadHistory(slug);
const saveHist = (slug, messages) => saveHistory(slug, messages);
const ctxFor = (slug) => contextId(slug);
const approxTurns = (min) => `约 ${Math.max(1, Math.round(min / 1.5))} 回合`;

export function ChatView({ focusSlug } = {}) {
  const auth = useAuth();
  const slug = focusSlug ?? "";
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState(null);
  const [messages, setMessages] = useState(() => (slug ? loadHist(slug) : []));
  const [input, setInput] = useState("");
  // Deep-link prefill (add-catalog-discovery): ?q= fills the composer once —
  // a catalog example lands as a ready-to-send draft, never auto-sent.
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || "").get("q");
    if (q) setInput((cur) => cur || q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [ownKey, setOwnKey] = useState(() => (slug ? ownKeyOf(slug) : ""));
  const [keyDraft, setKeyDraft] = useState("");
  const [ownKeyMode, setOwnKeyMode] = useState(false);
  // Ask lane (unify-cross-line-copilot 5.4): the in-site view renders questions
  // the same way the embed widget does — one shared card, one shared answer
  // route. This lane has no host page, so no intent verb is ever executable.
  const [pendingAsk, setPendingAsk] = useState(null); // { askId, questions, deadlineAt, bearer, busy }
  // 402 exhaustion is its own state — the agent stays OPEN (subsidy on), the
  // visitor is simply out of free allowance; rendering it as "not open"
  // would misname the situation and unmount the own-key bridge.
  const [exhausted, setExhausted] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    setMessages(loadHist(slug));
    setOwnKey(ownKeyOf(slug));
    setOwnKeyMode(false);
    setPendingAsk(null);
  }, [slug]);

  const refreshStatus = () => {
    if (!slug) return;
    setStatusErr(null);
    // authFetch: an expired id_token renews once transparently — a visitor
    // chatting past the token's lifetime must not see the anonymous shape
    // (its missing fields would render as zeros).
    authFetch(`/api/wanxing/v1/chat/${encodeURIComponent(slug)}/status`)
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

  // My matters (matter-threads V2 panel): the visitor's own escalation threads
  // on THIS agent — same visitor scope the chat turns carry, so the panel and
  // the reception agree. Refreshes after every turn (a matter may have been
  // opened) and on mount.
  const [matters, setMatters] = useState(null);
  const refreshMatters = () => {
    if (!slug || !auth.token) return;
    authFetch(`/api/wanxing/v1/chat/${encodeURIComponent(slug)}/matters`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setMatters(d.matters ?? []))
      .catch(() => setMatters(null));
  };
  useEffect(() => {
    refreshMatters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, auth.token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Local history exits (wanxing-first-visitor 5.3): clear (confirmed, two-step)
  // and export (download the local transcript). Local-first by contract — the
  // server persists no content, so export covers THIS device's turns only.
  const [clearArmed, setClearArmed] = useState(false);
  const clearHistory = () => {
    if (!clearArmed) { setClearArmed(true); return; }
    setMessages([]);
    saveHist(slug, []);
    setClearArmed(false);
  };
  const exportHistory = () => {
    const blob = new Blob([JSON.stringify({ agent: slug, exportedAt: new Date().toISOString(), turns: messages }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `wanxing-chat-${slug}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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
    const rpcBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "message/stream",
      params: { message: { role: "user", parts: [{ kind: "text", text }], context_id: ctxFor(slug) } },
    });
    try {
      // The own-key bridge rides the API lane with the pasted key verbatim
      // (raw fetch — authFetch would overwrite the bearer with the console
      // token); visitor turns go through authFetch for silent renewal.
      const r = useKey
        ? await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), Authorization: `Bearer ${ownKey}` },
            body: rpcBody,
          })
        : await authFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
            body: rpcBody,
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
      // SSE dispatch comes from chat-core.js — the same parser the embed widget
      // runs, so an ask reaches both shells identically (5.3: this lane used to
      // ignore ask frames entirely).
      const bearer = useKey ? ownKey : auth.token;
      const { text: acc, frameError: frameErr } = await parseTurnStream(r.body, {
        onText: (text) =>
          setMessages((prev) => {
            const base = prev.at(-1)?.role === "assistant" ? prev.slice(0, -1) : prev;
            return [...base, { role: "assistant", text, at: Date.now() }];
          }),
        onAsk: (a) => {
          // The own-key bridge rides the API lane, where asks do not exist.
          if (useKey) return;
          setPendingAsk({ ...a, bearer, busy: false });
        },
      });
      const finalBase = () =>
        setMessages((prev) => {
          const base = prev.at(-1)?.role === "assistant" ? prev : [...prev, { role: "assistant", text: acc || "（无输出）", at: Date.now() }];
          saveHist(slug, base);
          return base;
        });
      finalBase();
      if (frameErr) setNotice("本回合以错误告终——详见上方消息。");
      refreshStatus();
      refreshMatters();
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
    persistOwnKey(slug, k);
    setOwnKey(k);
    setOwnKeyMode(true);
    setKeyDraft("");
    setNotice("已启用你自己的调用键——后续回合按 API 车道计费。");
  };
  const dropOwnKey = () => {
    persistOwnKey(slug, "");
    setOwnKey("");
    setOwnKeyMode(false);
    refreshStatus();
  };

  // Answer (or cancel) the live ask through the shared side route, then record
  // the resolved summary in the transcript — same wording as the embed widget.
  const submitAsk = async ({ cancelled = false, answers = null } = {}) => {
    const ask = pendingAsk;
    if (!ask || ask.busy) return;
    setPendingAsk(null);
    const { note } = await postAskAnswer(slug, ask.bearer, { askId: ask.askId, answers, cancelled });
    const text = askSummaryText(ask.questions, { cancelled, answers: answers ?? [], note: note || undefined });
    setMessages((prev) => {
      const next = [...prev, { role: "ask", text, at: Date.now() }];
      saveHist(slug, next);
      return next;
    });
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
          <p className="text-sm text-slate-500">登录萬星后即可与 agent 对话（每日有免费额度）。</p>
          <button
            onClick={() =>
              loginLogto({ gate: "chat", returnTo: `#/chat/${encodeURIComponent(slug)}` }).catch((e) =>
                alert(String(e?.message || e)),
              )
            }
            className="w-full px-3 py-2.5 rounded-lg bg-accent text-white text-sm"
          >
            使用寻数账号登录（Logto）
          </button>
        </div>
      ) : statusErr ? (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm">
          状态读取失败（{statusErr}）——请稍后再试。
        </div>
      ) : !status ? (
        <SkeletonLines rows={2} />
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

          {Array.isArray(matters) && matters.length > 0 && (
            <details open className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm" data-testid="chat-matters-panel">
              <summary className="cursor-pointer text-xs text-slate-500 select-none">
                我的事项（{matters.length}）——接待转给主人的问题与回复
              </summary>
              <div className="mt-2 space-y-2">
                {matters.map((m) => (
                  <div key={m.id} className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2" data-testid={`chat-matter-${m.id}`}>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span
                        className={
                          m.status === "open"
                            ? "px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                            : m.status === "responded"
                              ? "px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                              : "px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-slate-800"
                        }
                      >
                        {m.status === "open" ? "待回应" : m.status === "responded" ? "已回应" : "已关闭"}
                      </span>
                      <code className="truncate">{m.id}</code>
                      <span className="ml-auto">{new Date(m.updatedAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{m.summary}</p>
                    {m.lastReply && (
                      <p className="mt-1 text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                        主人回应：{m.lastReply}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 h-[50vh] overflow-y-auto space-y-2 text-sm">
            {messages.length === 0 && <div className="text-slate-400">开始你的第一句——历史只保存在本机浏览器。</div>}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg bg-accent text-white px-3 py-2 whitespace-pre-wrap"
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

          {/* The same answerable card the embed widget renders (5.4). This
              lane has no host page, so no intent verb is ever executable. */}
          {pendingAsk && (
            <div className="mt-2">
              <AskCard ask={pendingAsk} onSubmit={submitAsk} hostIntents={[]} testId="wx-chat-ask" />
            </div>
          )}

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
              placeholder={
                pendingAsk
                  ? "请先回答上方问询…"
                  : ownKeyMode
                    ? `以你的调用键调用 ${agentName}…`
                    : `向 ${agentName} 说点什么…`
              }
              disabled={Boolean(pendingAsk)}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm disabled:opacity-60"
            />
            <button disabled={sending || Boolean(pendingAsk)} className="px-4 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-40">
              {sending ? "回复中…" : "发送"}
            </button>
          </form>
          {notice && <div className="text-xs text-amber-600 dark:text-amber-400">{notice}</div>}

          {messages.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-slate-500" data-testid="chat-history-tools">
              <button onClick={exportHistory} data-testid="chat-history-export" className="underline hover:text-slate-900 dark:hover:text-slate-100">
                导出本机记录
              </button>
              {clearArmed ? (
                <span className="flex items-center gap-1.5" data-testid="chat-history-clear-confirm">
                  <span className="text-rose-500">清空本机对话记录？</span>
                  <button onClick={clearHistory} className="px-2 py-0.5 rounded bg-rose-600 text-white">确认清空</button>
                  <button onClick={() => setClearArmed(false)} className="underline">取消</button>
                </span>
              ) : (
                <button onClick={clearHistory} data-testid="chat-history-clear" className="underline hover:text-rose-600">
                  清空记录
                </button>
              )}
              <span className="text-slate-400">仅本机：换设备不同步，服务端不存内容。</span>
            </div>
          )}

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
