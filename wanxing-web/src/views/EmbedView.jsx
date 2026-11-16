// Embed view (add-embed-copilot-lane 4.x): the copilot widget at
// #/embed/<slug>, loaded by product-line pages inside a cross-site iframe.
//
// Shape: a floating launcher that expands into a dock panel — the iframe IS
// the widget surface, so the host sizes/positions the iframe and the widget
// handles collapse/expand inside it (html/body go transparent while this
// view is mounted so the collapsed launcher floats over the host page).
//
// Identity ladder (D1/D3/D4, embed-auth.js): host-relayed tenant token per
// turn → stored tenant credential (popup login; the popup posts the
// credential back because its storage bucket is not ours) → anonymous
// ephemeral token (minted per agent against the attested embedding origin).
// Anonymous refusals surface the login upgrade; tenant exhaustion keeps the
// chat view's own-key bridge.
//
// Host protocol (D6, postMessage; first init wins the trusted origin):
//   host → widget  { type: "wx-copilot-init", intents? }            handshake (+declared intent verbs)
//   host → widget  { type: "wx-copilot-context", line, page, entity, intent }
//   host → widget  { type: "wx-copilot-identity", token }         relayed ID token
//   host → widget  { type: "wx-copilot-intent-result", askId, questionId, ok, message? }
//   widget → host  { type: "wx-copilot-ready", slug }
//   widget → host  { type: "wx-copilot-identity-request" }        before a turn
//   widget → host  { type: "wx-copilot-state", open }             collapse/expand
//   widget → host  { type: "wx-copilot-intent", askId, questionId, verb, arg }
// Context is delivered to the agent as a MARKED prefix on the first turn
// (host-provided data, not a user instruction) and mirrored in the bar.
//
// Ask lane (add-copilot-control-surface): the turn stream dispatches by SSE
// event name — an `ask` event renders as an answerable inquiry card (options
// / multi-select / custom / cancel / deadline countdown; the widget cancels
// itself just before the deadline) and the answer rides the facade's
// ask-answer side route under the turn's own credential. A question whose id
// has the form intent:<verb>:<arg> is a HOST intent: the widget executes
// nothing itself — selecting the question's first option posts the intent to
// the trusted host, waits for its result, and answers the ask with the
// outcome. No click, no page action — host context and foreign-origin
// messages can never trigger one.
import { useEffect, useRef, useState } from "react";
import { EMBED_AUTH_MESSAGE, authFetch, prepareLogin } from "../auth.js";
import { anonClear, credClear, credGet, credSet, EmbedAuthError, refreshCred, resolveBearer } from "../embed-auth.js";
import { AskCard } from "../components/AskCard.jsx";
import {
  askSummaryText,
  contextId,
  contextPrefix,
  loadHistory,
  normalizeHostContext,
  ownKeyOf,
  parseIntent,
  parseTurnStream,
  postAskAnswer,
  renderMarkdown,
  saveHistory,
  setOwnKey as persistOwnKey,
} from "../chat-core.js";

// Conversation persistence and stream parsing are SHARED with the chat view
// (chat-core.js). This file keeps only what is embed-specific: the identity
// ladder, the host protocol, and the widget shell.
const loadHist = (slug) => loadHistory(slug);
const saveHist = (slug, messages) => saveHistory(slug, messages);
const ctxFor = (slug) => contextId(slug);

// Transcript bubble styling per role and theme. Written as an explicit map (not
// nested ternaries) so each theme's foreground is paired with its own surface
// and a static reader can see the pairing.
const bubbleClass = (role, dark) => {
  if (role === "user") return "text-white";
  if (role === "assistant") return dark ? "bg-slate-800" : "bg-slate-100";
  if (role === "error") return "bg-red-50 text-red-700";
  // ask summary + system notes: a quiet strip, never a live card
  if (dark) return "border-l-2 border-slate-600 bg-slate-800 text-slate-300 text-xs";
  return "border-l-2 border-amber-300 bg-amber-50 text-amber-800 text-xs";
};

// URL parameters ride the hash query: #/embed/<slug>?accent=%23hex&mode=dark&title=...&open=1
const hashParams = () => new URLSearchParams(window.location.hash.split("?")[1] || "");
const safeColor = (v) => (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null);
const referrerOrigin = () => {
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
};

// Host protocol, the identity ladder, and the widget shell are embed-specific
// and stay here. Context prefix, intent parsing, the ask summary, frame text,
// history, and stream dispatch all come from chat-core.js (shared with #/chat).

export function EmbedView({ focusSlug } = {}) {
  const slug = focusSlug ?? "";
  const params = hashParams();
  const accent = safeColor(params.get("accent")) ?? "#0f172a";
  const dark = params.get("mode") === "dark";
  const titleOverride = params.get("title");
  const [open, setOpen] = useState(params.get("open") === "1");

  const [config, setConfig] = useState(null); // embed-config
  const [configErr, setConfigErr] = useState(null);
  const [messages, setMessages] = useState(() => (slug ? loadHist(slug) : []));
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [tier, setTier] = useState(() => (slug && credGet(slug)?.idToken ? "tenant" : "anon"));
  const [email, setEmail] = useState(() => (slug ? credGet(slug)?.email ?? "" : ""));
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [loginFallbackUrl, setLoginFallbackUrl] = useState("");
  const [exhausted, setExhausted] = useState(false);
  const [remaining, setRemaining] = useState(null); // minutes, by tier
  const [ownKey, setOwnKey] = useState(() => (slug ? ownKeyOf(slug) : ""));
  const [keyDraft, setKeyDraft] = useState("");
  const [context, setContext] = useState({});
  const [contextSent, setContextSent] = useState(false);
  // Ask lane: the live inquiry card (one per turn in practice) and the host's
  // declared intent verbs (from init; empty = no host or none declared). The
  // card's own selections/countdown live in AskCard, shared with #/chat.
  const [pendingAsk, setPendingAsk] = useState(null); // { askId, questions, deadlineAt, bearer, busy }
  const [hostIntents, setHostIntents] = useState([]);

  const hostOriginRef = useRef(null); // the trusted embedding origin (first init wins)
  const hostTokenRef = useRef(null); // relayed identity for the current turn only
  const identityWaiters = useRef([]);
  const intentWaiters = useRef([]); // { askId, questionId, done }
  const pendingAskRef = useRef(null); // mirror of pendingAsk for timers/handlers
  const bottomRef = useRef(null);

  // Transparent document while mounted — the collapsed launcher floats.
  useEffect(() => {
    const html = document.documentElement, body = document.body;
    const prev = [html.style.background, body.style.background, html.style.colorScheme];
    html.style.background = "transparent";
    body.style.background = "transparent";
    html.style.colorScheme = dark ? "dark" : "light";
    return () => {
      [html.style.background, body.style.background, html.style.colorScheme] = prev;
    };
  }, [dark]);

  // Cold start: the public embed-config answers chatability + anonymous availability.
  useEffect(() => {
    if (!slug) return;
    setConfigErr(null);
    fetch(`/api/wanxing/v1/chat/${encodeURIComponent(slug)}/embed-config`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw Object.assign(new Error(d?.error?.code || `HTTP ${r.status}`), { status: r.status });
        }
        return r.json();
      })
      .then(setConfig)
      .catch((e) => setConfigErr(String(e?.message || e)));
  }, [slug]);

  const postToHost = (msg) => {
    if (window.parent === window) return;
    const target = hostOriginRef.current;
    if (!target) return;
    try {
      window.parent.postMessage({ ...msg, slug }, target);
    } catch { /* host gone */ }
  };

  // Host protocol + popup credential handoff.
  useEffect(() => {
    const onMessage = (ev) => {
      const d = ev.data;
      if (!d || typeof d !== "object") return;
      // Popup login handoff: only our own origin may deliver a credential.
      if (d.type === EMBED_AUTH_MESSAGE) {
        if (ev.origin !== window.location.origin || !d.id_token) return;
        credSet(slug, { idToken: d.id_token, refreshToken: d.refresh_token ?? null, email: d.email ?? "" });
        setTier("tenant");
        setEmail(d.email ?? "");
        setLoginNeeded(false);
        setLoginFallbackUrl("");
        setNotice("已登录——后续回合按登录访客额度计费。");
        return;
      }
      // Host messages: the first init (or first context) locks the trusted
      // origin; anything from another origin is dropped silently.
      if (d.type === "wx-copilot-init" || d.type === "wx-copilot-context" || d.type === "wx-copilot-identity" || d.type === "wx-copilot-intent-result") {
        if (!hostOriginRef.current) {
          if (ev.source !== window.parent) return; // only our embedder may claim to be the host
          hostOriginRef.current = ev.origin;
          postToHost({ type: "wx-copilot-ready" });
        } else if (ev.origin !== hostOriginRef.current) {
          return;
        }
      } else {
        return;
      }
      if (d.type === "wx-copilot-init") {
        // Declared intent verbs: only these render as executable; the widget
        // never invents a verb the host did not claim.
        setHostIntents(Array.isArray(d.intents) ? d.intents.filter((v) => typeof v === "string" && /^[a-z][a-z-]{0,31}$/.test(v)).slice(0, 32) : []);
      }
      if (d.type === "wx-copilot-intent-result") {
        const w = intentWaiters.current.find((x) => x.askId === d.askId && x.questionId === d.questionId);
        if (w) {
          intentWaiters.current = intentWaiters.current.filter((x) => x !== w);
          w.done({ ok: d.ok === true, message: typeof d.message === "string" ? d.message.slice(0, 300) : "" });
        }
      }
      if (d.type === "wx-copilot-context") {
        setContext(normalizeHostContext(d));
        setContextSent(false); // refreshed context rides the next turn
      }
      if (d.type === "wx-copilot-identity") {
        const token = typeof d.token === "string" && d.token ? d.token : null;
        hostTokenRef.current = token;
        for (const w of identityWaiters.current.splice(0)) w(token);
      }
    };
    window.addEventListener("message", onMessage);

    // 握手不能由宿主的 init 触发（spread-line-copilot 真机 2026-11-16 抓到的死锁）：
    // loader 只在收到 ready 后才发 init，而这里原本只在收到 init 后才发 ready ——
    // 双方互等，ready 永不到达，于是 hostOriginRef 始终为 null、identity-request
    // 被第 238 行整条跳过，宿主身份（识律的 Logto 票）从未递到 widget。
    // 正确做法：iframe 在本源内加载完成就主动报 ready。ready 不含任何凭据，
    // 提前发出不削弱可信来源判定——那条仍由「首条宿主消息的 ev.source 必须是
    // window.parent」把关，这里只是把「我活着」先说出去。
    //
    // 只对本源内的 parent 宣告；跨源嵌入时 parent 的 origin 取不到，仍等宿主先说话。
    const announce = () => {
      if (window.parent === window) return;
      // 目标源必须**不是自己**：iframe 重载/内部导航时 document.referrer 会等于
      // 本页自己的源（2026-11-16 实测：referrer = https://wanxing.finddatatech.cloud/，
      // 而宿主是 lex.finddatatech.cloud）。拿自己的源当 target，消息会被浏览器
      // 静默丢弃，握手又回到死锁。所以只接受「与自己不同源的 referrer」，
      // 否则退 "*"——安全性由 loader 侧的 ev.origin / ev.source 校验兜底。
      const ref = referrerOrigin();
      const target = ref && ref !== window.location.origin ? ref : "*";
      try {
        window.parent.postMessage({ type: "wx-copilot-ready", slug }, target);
      } catch {
        /* host gone */
      }
    };
    announce();
    const t = setTimeout(announce, 600); // parent 监听器可能晚于本帧就绪

    return () => {
      clearTimeout(t);
      window.removeEventListener("message", onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  useEffect(() => {
    postToHost({ type: "wx-copilot-state", open });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Ask the host for a fresh identity token for this turn (D3: per-turn,
  // never persisted). Resolves null when no host, or no answer in time.
  const requestHostIdentity = () =>
    new Promise((resolve) => {
      if (!hostOriginRef.current || window.parent === window) return resolve(hostTokenRef.current);
      const t = setTimeout(() => {
        identityWaiters.current = identityWaiters.current.filter((w) => w !== done);
        resolve(hostTokenRef.current);
      }, 800);
      const done = (tok) => {
        clearTimeout(t);
        resolve(tok);
      };
      identityWaiters.current.push(done);
      postToHost({ type: "wx-copilot-identity-request" });
    });

  const embeddingOrigin = () => hostOriginRef.current ?? referrerOrigin();

  // ── Ask lane (add-copilot-control-surface) ────────────────────────────────
  // Post an intent to the trusted host and wait ≤8s for its result. No host,
  // no trusted origin, or an undeclared verb → unsupported (the card says so
  // and the answer carries that outcome — the agent adapts).
  const runIntent = (askId, question) =>
    new Promise((resolve) => {
      const parsed = parseIntent(question.id);
      if (!parsed) return resolve({ ok: false, unsupported: true, message: "无效的意图信封" });
      if (window.parent === window || !hostOriginRef.current) {
        return resolve({ ok: false, unsupported: true, message: "当前页面不支持此操作（无宿主）" });
      }
      if (!hostIntents.includes(parsed.verb)) {
        return resolve({ ok: false, unsupported: true, message: `当前页面不支持此操作（宿主未声明 ${parsed.verb}）` });
      }
      const t = setTimeout(() => {
        intentWaiters.current = intentWaiters.current.filter((w) => w.done !== done);
        resolve({ ok: false, message: "宿主未响应" });
      }, 8_000);
      const done = (result) => {
        clearTimeout(t);
        resolve(result);
      };
      intentWaiters.current.push({ askId, questionId: question.id, done });
      postToHost({ type: "wx-copilot-intent", askId, questionId: question.id, verb: parsed.verb, arg: parsed.arg });
    });

  // Submit (or cancel) the live ask through the side route under the ask's
  // own turn credential, then converge the card locally — the stream's
  // continuation is the authoritative display either way, and the runner's
  // deadline cancel is the backstop when delivery itself failed.
  const submitAsk = async ({ cancelled = false, answers = null } = {}) => {
    const ask = pendingAskRef.current;
    if (!ask) return;
    pendingAskRef.current = null;
    setPendingAsk(null);
    // authFetch re-reads the console token per call and renews on 401 —
    // a turn can outlive the id_token it started with.
    const { note } = await postAskAnswer(slug, ask.bearer, { askId: ask.askId, answers, cancelled, fetchImpl: authFetch });
    const text = askSummaryText(ask.questions, { cancelled, answers: answers ?? [], note: note || undefined });
    setMessages((prev) => {
      const next = [...prev, { role: "ask", text, at: Date.now() }];
      saveHist(slug, next);
      return next;
    });
  };

  // A click on an option of an INTENT question: the first option executes
  // (host result rides the answer), anything else declines without posting.
  const clickIntentOption = async (question, label) => {
    const ask = pendingAskRef.current;
    if (!ask || ask.busy) return;
    const first = question.options?.[0]?.label === label;
    const answer = { id: question.id, selected: [label] };
    if (!first) {
      await submitAsk({ answers: [answer] });
      return;
    }
    setPendingAsk((p) => (p ? { ...p, busy: true } : p));
    const res = await runIntent(ask.askId, question);
    if (!res.ok && res.message) answer.custom = res.message;
    await submitAsk({ answers: [answer] });
  };

  // The countdown and the pre-deadline self-cancel live in AskCard (shared
  // with #/chat); this container only supplies the transport.

  const refreshRemaining = async (bearer, curTier) => {
    if (!bearer) return;
    try {
      const r = await fetch(`/api/wanxing/v1/chat/${encodeURIComponent(slug)}/status`, { headers: { Authorization: `Bearer ${bearer}` } });
      if (!r.ok) return;
      const d = await r.json();
      if (curTier === "anon") setRemaining(d.anonymousRemainingToday ?? null);
      else setRemaining(d.subsidyRemainingToday != null ? d.subsidyRemainingToday + (d.hostPoolRemaining ?? 0) : null);
    } catch { /* display-only */ }
  };

  const startLogin = async () => {
    try {
      const url = await prepareLogin({ gate: "chat", returnTo: "#/", embedParent: embeddingOrigin() ?? window.location.origin });
      // window.open keeps the opener unless "noopener" is requested — the
      // callback posts the credential to it (anchor fallback needs rel=opener).
      const w = window.open(url, "wx-embed-login", "width=520,height=720");
      if (!w) setLoginFallbackUrl(url); // popup blocked → explicit new-window link
    } catch (e) {
      setNotice(String(e?.message || e));
    }
  };
  const logout = () => {
    credClear(slug);
    setTier("anon");
    setEmail("");
    setRemaining(null);
  };

  const sysMsg = (base, text) => {
    const next = [...base, { role: "system", text, at: Date.now() }];
    setMessages(next);
    saveHist(slug, next);
  };

  const send = async () => {
    const raw = input.trim();
    if (!raw || sending || !slug) return;
    setInput("");
    setNotice("");
    const useKey = exhausted && ownKey;
    const shown = [...messages, { role: "user", text: raw, at: Date.now() }];
    setMessages(shown);
    saveHist(slug, shown);
    setSending(true);

    // Context rides the FIRST turn after it arrives, as a marked prefix.
    const prefix = !contextSent ? contextPrefix(context) : "";
    const text = prefix ? `${prefix}${raw}` : raw;

    const rpcBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "message/stream",
      params: { message: { role: "user", parts: [{ kind: "text", text }], context_id: ctxFor(slug) } },
    });

    const doTurn = async (bearer, tierUsed) => {
      const url = useKey ? `/api/wanxing/v1/a2a/${encodeURIComponent(slug)}` : `/api/wanxing/v1/chat/${encodeURIComponent(slug)}`;
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), Authorization: `Bearer ${useKey ? ownKey : bearer}` },
        body: rpcBody,
      }).then((r) => ({ r, tierUsed }));
    };

    try {
      let resolved = { bearer: null, tier: null };
      if (!useKey) {
        const hostToken = await requestHostIdentity();
        try {
          resolved = await resolveBearer(slug, { hostToken, origin: embeddingOrigin(), anonAllowed: config?.anonymous === true });
        } catch (e) {
          if (e instanceof EmbedAuthError && (e.code === "ANON_NOT_OPEN" || e.body?.error?.loginUpgrade)) {
            setLoginNeeded(true);
            sysMsg(shown, "本助手未开放匿名对话——登录萬星后继续。");
            return;
          }
          if (e instanceof EmbedAuthError && e.code === "EMBED_ORIGIN_NOT_ALLOWED") {
            sysMsg(shown, "当前页面未被允许嵌入该助手（嵌入来源未在允许列表）。");
            return;
          }
          throw e;
        }
        if (!resolved.bearer) {
          setLoginNeeded(true);
          sysMsg(shown, "需要登录萬星后才能对话。");
          return;
        }
        setTier(resolved.tier);
        if (resolved.email !== undefined) setEmail(resolved.email);
      }

      let { r } = await doTurn(resolved.bearer, resolved.tier);
      // One silent credential retry: stored tenant pair → refresh; anonymous → re-mint.
      if (r.status === 401 && !useKey && resolved.source !== "host") {
        let retried = false;
        if (resolved.tier === "tenant" && (await refreshCred(slug).catch(() => false))) {
          resolved = { ...resolved, bearer: credGet(slug)?.idToken };
          retried = Boolean(resolved.bearer);
        } else if (resolved.tier === "anon") {
          anonClear(slug);
          try {
            resolved = await resolveBearer(slug, { origin: embeddingOrigin(), anonAllowed: config?.anonymous === true });
            retried = Boolean(resolved.bearer);
          } catch { /* fall through to the error path */ }
        }
        if (retried) ({ r } = await doTurn(resolved.bearer, resolved.tier));
      }

      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const code = d?.error?.code ?? `HTTP ${r.status}`;
        if (code === "ANON_ALLOWANCE_EXHAUSTED" || code === "ANON_NOT_OPEN" || d?.error?.loginUpgrade) {
          setLoginNeeded(true);
          sysMsg(shown, code === "ANON_NOT_OPEN" ? "本助手未开放匿名对话——登录萬星后继续。" : "今日匿名额度已用完——登录萬星后以完整额度继续。");
        } else if (code === "CHAT_ALLOWANCE_EXHAUSTED") {
          setExhausted(true);
          sysMsg(shown, "免费额度已用完——可粘贴自己的调用键继续对话。");
        } else if (code === "VISITOR_AUTH_REQUIRED") {
          if (resolved.tier === "tenant") logout();
          setLoginNeeded(true);
          sysMsg(shown, "登录已失效——请重新登录。");
        } else {
          const failed = [...shown, { role: "error", text: d?.error?.message || code, at: Date.now() }];
          setMessages(failed);
          saveHist(slug, failed);
          setNotice(code);
        }
        return;
      }

      if (prefix) setContextSent(true);

      // SSE dispatch comes from chat-core.js — the same parser the in-site chat
      // view runs, so an ask reaches both shells identically.
      const { text: acc, frameError: frameErr } = await parseTurnStream(r.body, {
        onText: (t) =>
          setMessages((prev) => {
            const base = prev.at(-1)?.role === "assistant" ? prev.slice(0, -1) : prev;
            return [...base, { role: "assistant", text: t, at: Date.now() }];
          }),
        onAsk: (a) => {
          // The own-key bridge rides the API lane, where asks do not exist.
          if (useKey) return;
          const ask = { ...a, bearer: resolved.bearer, busy: false };
          pendingAskRef.current = ask;
          setPendingAsk(ask);
        },
      });
      setMessages((prev) => {
        const base = prev.at(-1)?.role === "assistant" ? prev : [...prev, { role: "assistant", text: acc || "（无输出）", at: Date.now() }];
        saveHist(slug, base);
        return base;
      });
      if (frameErr) setNotice("本回合以错误告终——详见上方消息。");
      if (!useKey) void refreshRemaining(resolved.bearer, resolved.tier);
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
    setKeyDraft("");
    setNotice("已启用你自己的调用键——后续回合按 API 车道计费。");
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const fg = dark ? "text-slate-100" : "text-slate-900";
  const panelBg = dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200";
  const subtle = dark ? "text-slate-400" : "text-slate-500";
  const agentName = titleOverride || config?.agent?.name || slug || "副驾";
  const hasContext = Boolean(context.line || context.page || context.entity || context.intent);

  if (!slug) {
    return <div className={`p-3 text-sm ${subtle}`}>缺少 agent——嵌入地址应为 #/embed/&lt;slug&gt;。</div>;
  }

  if (!open) {
    return (
      <div className="fixed bottom-3 right-3">
        <button
          type="button"
          data-testid="wx-embed-launcher"
          aria-label={`打开 ${agentName}`}
          onClick={() => setOpen(true)}
          className="grid h-12 w-12 place-items-center rounded-full text-white shadow-lg transition-opacity hover:opacity-90"
          style={{ background: accent }}
        >
          <span className="text-lg leading-none">✦</span>
        </button>
      </div>
    );
  }

  return (
    <div data-testid="wx-embed-panel" className={`flex h-screen w-full flex-col overflow-hidden border ${panelBg} ${fg} text-sm`}>
      <header className="flex items-center gap-2 px-3 py-2 text-white" style={{ background: accent }}>
        <span className="font-medium">{agentName}</span>
        <span className="rounded bg-white/20 px-1.5 py-0.5 text-[11px]" data-testid="wx-embed-tier">
          {tier === "tenant" ? (email ? `已登录 · ${email}` : "已登录") : "匿名"}
        </span>
        {remaining != null && <span className="text-[11px] opacity-80">今日剩余约 {remaining} 分钟</span>}
        <span className="ml-auto flex items-center gap-2">
          {tier === "tenant" ? (
            <button type="button" onClick={logout} className="text-[11px] underline opacity-80 hover:opacity-100">退出</button>
          ) : (
            <button type="button" onClick={startLogin} className="text-[11px] underline opacity-80 hover:opacity-100" data-testid="wx-embed-login">登录</button>
          )}
          <button type="button" aria-label="收起" onClick={() => setOpen(false)} className="grid h-6 w-6 place-items-center rounded hover:bg-white/20">—</button>
        </span>
      </header>

      {/* Anonymous turns have no identity of their own, so any external-system
          action the assistant takes runs as the DEPLOYER, not as the visitor
          (paas add-served-agent-connector-access D5). Saying it here is the
          whole point: the failure mode this replaces was a turn that quietly
          used someone else's account while everyone assumed it was theirs.
          Phrased conditionally — "if it needs to reach an external system" —
          because a turn that never touches a connector has nothing to disclose,
          and a blanket "this ran as the deployer" would be a different lie. */}
      {tier === "anon" && (
        <div
          data-testid="wx-embed-deployer-notice"
          className={`border-b px-3 py-1.5 text-[11px] ${dark ? "border-slate-700 bg-slate-800 text-slate-300" : "border-amber-200 bg-amber-50 text-amber-800"}`}
        >
          未登录：如需访问外部系统（订单、库存等），将以部署者身份执行，而不是你本人。
        </div>
      )}

      {hasContext && (
        <div data-testid="wx-embed-context" className={`border-b px-3 py-1.5 text-[11px] ${dark ? "border-slate-700 bg-slate-800 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
          <span className="font-medium">页面上下文</span>
          {context.line && <span className="ml-2">{context.line}</span>}
          {context.page && <span className="ml-2 truncate">{context.page}</span>}
          {context.entity && <span className="ml-2">{context.entity}</span>}
          {context.intent && <span className="ml-2">{context.intent}</span>}
          <span className={`ml-2 ${subtle}`}>{contextSent ? "（已随首回合发送）" : "（将随下一回合发送）"}</span>
        </div>
      )}

      {configErr && (
        <div className="px-3 py-2 text-xs text-red-600">
          {configErr.includes("AGENT_NOT_FOUND") ? "该助手不存在或未公开。" : `无法加载助手配置：${configErr}`}
        </div>
      )}
      {config && !config.chatAble && !config.anonymous && (
        <div className={`px-3 py-2 text-xs ${subtle}`}>
          {config.reason === "agent_paused" ? "该助手已暂停——恢复后即可对话。" : "该助手当前未开放对话。"}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {messages.length === 0 && (
          <p className={`text-xs ${subtle}`}>
            {config?.anonymous ? "可直接提问，无需登录。" : "登录萬星后开始对话。"}
            {config?.agent?.description ? ` ${config.agent.description}` : ""}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 ${m.role === "assistant" ? "wx-md" : "whitespace-pre-wrap"} ${bubbleClass(m.role, dark)}`}
              style={m.role === "user" ? { background: accent } : undefined}
            >
              {/* Same controlled formatter as #/chat (2.4) — one surface's
                  answer must never look different in the other. */}
              {m.role === "assistant" ? (
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
              ) : (
                m.text
              )}
            </div>
          </div>
        ))}

        {pendingAsk && (
          <AskCard
            ask={pendingAsk}
            onSubmit={submitAsk}
            onIntentChoice={clickIntentOption}
            hostIntents={hostIntents}
            accent={accent}
            dark={dark}
            testId="wx-embed-ask"
          />
        )}

        <div ref={bottomRef} />
      </div>

      {loginNeeded && tier !== "tenant" && (
        <div data-testid="wx-embed-login-upgrade" className={`border-t px-3 py-2 text-xs ${dark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
          {/* Name the destination (unify-cross-line-copilot 3.2): a visitor who
              arrived from a product-line page must never be asked, invisibly,
              to sign into a product they did not open. A host relaying its own
              identity (loader `identify()`) never reaches this bar. */}
          <span>登录萬星后继续对话（完整额度，跨设备记录）。</span>
          <button type="button" onClick={startLogin} className="ml-2 rounded px-2 py-0.5 text-white" style={{ background: accent }}>登录萬星</button>
          {loginFallbackUrl && (
            <a className="ml-2 underline" href={loginFallbackUrl} target="_blank" rel="opener">弹窗被拦截？在新窗口打开登录</a>
          )}
        </div>
      )}

      {exhausted && tier === "tenant" && (
        <details className={`border-t px-3 py-2 text-xs ${dark ? "border-slate-700" : "border-slate-200"}`} open>
          <summary className="cursor-pointer select-none">额度用完了——粘贴自己的调用键继续</summary>
          <div className="mt-2 flex gap-2">
            <input
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="sk-…（只保存在本机浏览器）"
              className={`flex-1 rounded border px-2 py-1 ${dark ? "border-slate-600 bg-slate-800" : "border-slate-300"}`}
            />
            <button type="button" onClick={applyOwnKey} className="rounded px-2 py-1 text-white" style={{ background: accent }}>启用</button>
          </div>
          {ownKey && <p className={`mt-1 ${subtle}`}>已启用自带键（{ownKey.slice(0, 6)}…）。</p>}
        </details>
      )}

      {notice && <div className={`px-3 py-1 text-[11px] ${subtle}`}>{notice}</div>}

      <form
        className={`flex gap-2 border-t p-2 ${dark ? "border-slate-700" : "border-slate-200"}`}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          data-testid="wx-embed-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={pendingAsk ? "请先回答上方问询…" : sending ? "回合进行中…" : "输入消息"}
          disabled={sending}
          className={`flex-1 rounded border px-2 py-1.5 ${dark ? "border-slate-600 bg-slate-800 text-slate-100" : "border-slate-300"}`}
        />
        <button type="submit" disabled={sending || !input.trim()} className="rounded px-3 py-1.5 text-white disabled:opacity-50" style={{ background: accent }}>
          发送
        </button>
      </form>
    </div>
  );
}
