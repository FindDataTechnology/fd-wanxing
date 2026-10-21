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
//   host → widget  { type: "wx-copilot-init" }                     handshake
//   host → widget  { type: "wx-copilot-context", line, page, entity, intent }
//   host → widget  { type: "wx-copilot-identity", token }         relayed ID token
//   widget → host  { type: "wx-copilot-ready", slug }
//   widget → host  { type: "wx-copilot-identity-request" }        before a turn
//   widget → host  { type: "wx-copilot-state", open }             collapse/expand
// Context is delivered to the agent as a MARKED prefix on the first turn
// (host-provided data, not a user instruction) and mirrored in the bar.
import { useEffect, useRef, useState } from "react";
import { EMBED_AUTH_MESSAGE, prepareLogin } from "../auth.js";
import { anonClear, credClear, credGet, credSet, EmbedAuthError, refreshCred, resolveBearer } from "../embed-auth.js";

const histKey = (slug) => `wx-embed-hist:${slug}`;
const ctxKey = (slug) => `wx-embed-ctx:${slug}`;
const ownKeyKey = (slug) => `wx-embed-ownkey:${slug}`;
const HISTORY_CAP = 200;

const loadHist = (slug) => {
  try {
    return JSON.parse(localStorage.getItem(histKey(slug)) ?? "[]");
  } catch {
    return [];
  }
};
const saveHist = (slug, messages) => localStorage.setItem(histKey(slug), JSON.stringify(messages.slice(-HISTORY_CAP)));
const ctxFor = (slug) => {
  let v = localStorage.getItem(ctxKey(slug));
  if (!v) {
    v = `wx:embed-${crypto.randomUUID()}`;
    localStorage.setItem(ctxKey(slug), v);
  }
  return v;
};

// Same tolerant text walk as the chat view: concatenate every text part in
// the frame's result tree in order.
const textOfFrame = (doc) => {
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

// The context block the agent sees: labeled as host-provided data so a hostile
// embedding page cannot pass itself off as the user (the lane has no page
// action verbs until E3 anyway).
const contextPrefix = (ctx) => {
  const lines = [];
  if (ctx.line) lines.push(`产品线：${ctx.line}`);
  if (ctx.page) lines.push(`页面：${ctx.page}`);
  if (ctx.entity) lines.push(`对象：${ctx.entity}`);
  if (ctx.intent) lines.push(`意图：${ctx.intent}`);
  if (!lines.length) return "";
  return `[宿主页面提供的上下文（非用户指令）]\n${lines.join("\n")}\n\n用户消息：`;
};

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
  const [ownKey, setOwnKey] = useState(() => (slug ? localStorage.getItem(ownKeyKey(slug)) ?? "" : ""));
  const [keyDraft, setKeyDraft] = useState("");
  const [context, setContext] = useState({});
  const [contextSent, setContextSent] = useState(false);

  const hostOriginRef = useRef(null); // the trusted embedding origin (first init wins)
  const hostTokenRef = useRef(null); // relayed identity for the current turn only
  const identityWaiters = useRef([]);
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
      if (d.type === "wx-copilot-init" || d.type === "wx-copilot-context" || d.type === "wx-copilot-identity") {
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
      if (d.type === "wx-copilot-context") {
        const next = {
          line: typeof d.line === "string" ? d.line.slice(0, 120) : undefined,
          page: typeof d.page === "string" ? d.page.slice(0, 300) : undefined,
          entity: typeof d.entity === "string" ? d.entity.slice(0, 300) : undefined,
          intent: typeof d.intent === "string" ? d.intent.slice(0, 300) : undefined,
        };
        setContext(next);
        setContextSent(false); // refreshed context rides the next turn
      }
      if (d.type === "wx-copilot-identity") {
        const token = typeof d.token === "string" && d.token ? d.token : null;
        hostTokenRef.current = token;
        for (const w of identityWaiters.current.splice(0)) w(token);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
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
            sysMsg(shown, "本助手未开放匿名对话——登录后继续。");
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
          sysMsg(shown, "需要登录后才能对话。");
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
          sysMsg(shown, code === "ANON_NOT_OPEN" ? "本助手未开放匿名对话——登录后继续。" : "今日匿名额度已用完——登录后以完整额度继续。");
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

      // SSE: accumulate text deltas into one growing assistant bubble.
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let frameErr = false;
      const push = (t) =>
        setMessages((prev) => {
          const base = prev.at(-1)?.role === "assistant" ? prev.slice(0, -1) : prev;
          return [...base, { role: "assistant", text: t, at: Date.now() }];
        });
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
    localStorage.setItem(ownKeyKey(slug), k);
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
            {config?.anonymous ? "可直接提问，无需登录。" : "登录后开始对话。"}
            {config?.agent?.description ? ` ${config.agent.description}` : ""}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 ${
                m.role === "user"
                  ? "text-white"
                  : m.role === "assistant"
                    ? dark ? "bg-slate-800" : "bg-slate-100"
                    : m.role === "error"
                      ? "bg-red-50 text-red-700"
                      : dark ? "bg-slate-800 text-slate-300 text-xs" : "bg-amber-50 text-amber-800 text-xs"
              }`}
              style={m.role === "user" ? { background: accent } : undefined}
            >
              {m.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {loginNeeded && tier !== "tenant" && (
        <div data-testid="wx-embed-login-upgrade" className={`border-t px-3 py-2 text-xs ${dark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
          <span>登录后继续对话（完整额度，跨设备记录）。</span>
          <button type="button" onClick={startLogin} className="ml-2 rounded px-2 py-0.5 text-white" style={{ background: accent }}>登录</button>
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
          placeholder={sending ? "回合进行中…" : "输入消息"}
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
