// ── Wanxing cross-line copilot loader (unify-cross-line-copilot 2.x) ─────────
//
// One tag mounts a product line's outward copilot and nothing else:
//
//   <script src="https://wanxing.finddatatech.cloud/copilot.js"
//           data-line="lex" async></script>
//
// THIS FILE IS THE HOST. Everything a product-line page used to hand-write
// (iframe creation, the wx-copilot-* handshake, per-turn identity relay,
// page-context pushes, intent dispatch) lives here, so the protocol has one
// implementation instead of one per line. Hosts only declare optional hooks:
//
//   window.WanxingCopilot = window.WanxingCopilot || {};
//   WanxingCopilot.identify = () => ({ token });        // per turn; may be async
//   WanxingCopilot.context  = () => ({ page, entity }); // on ready + route events
//   WanxingCopilot.intents  = { navigate: (arg) => router.push(arg) };
//
// Non-goals: this is a host-side convenience, never a new admission path. The
// widget inside the iframe enforces identity, allowance, and settlement exactly
// as it does for a hand-written embed. Admission is decided by the facade, and
// the binding's "intent" never opens a gate by itself.
//
// Degradation is deliberate: unbound / unknown / closed lines mount NOTHING and
// log one reason. A silent dead card costs a visitor a click and teaches them
// the wrong mental model; a missing entry costs nothing.

(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return; // no src → nothing to resolve against
  var api = (window.WanxingCopilot = window.WanxingCopilot || {});
  if (api.__loaderMounted) return; // one widget per page
  api.__loaderMounted = true;

  var ORIGIN = new URL(script.src, window.location.href).origin;
  var LINE = (script.getAttribute("data-line") || "").trim();
  var ACCENT = (script.getAttribute("data-accent") || "").trim();
  var TITLE = (script.getAttribute("data-title") || "").trim();
  // Collapsed on first paint unless the host says otherwise: expanding is the
  // host's explicit choice (data-open="1"), never a default it must remember to
  // suppress. Two hosts already shipped a 420x640 panel over their own content
  // because they omitted the attribute.
  var OPEN = script.getAttribute("data-open") === "1";

  var frame = null;
  var warned = false;

  function warn(reason) {
    if (warned) return;
    warned = true;
    try {
      console.warn("[wanxing-copilot] line '" + LINE + "' — " + reason + "; widget not mounted");
    } catch (_) { /* console may be gone */ }
  }

  // Host → widget: always addressed to the widget's origin, always tagged with
  // the slug so a page carrying two embeds cannot cross wires.
  function post(slug, msg) {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage(Object.assign({ slug: slug }, msg), ORIGIN);
    } catch (_) { /* host navigating away */ }
  }

  function hook(name) {
    var f = api[name];
    return typeof f === "function" ? f : null;
  }

  // Optional observability hook: hosts (and /host-demo.html) can watch the
  // protocol without implementing any of it.
  function emit(type, detail) {
    var f = hook("onEvent");
    if (!f) return;
    try { f(type, detail || {}); } catch (_) { /* a broken logger never breaks a turn */ }
  }

  // Resolve a hook result that may be a value or a promise, without requiring
  // Promise support to be detected first (the widget waits either way).
  function settle(value, then) {
    if (value && typeof value.then === "function") value.then(then, function () { then(null); });
    else then(value);
  }

  function sendContext(slug) {
    var ctx = hook("context");
    if (!ctx) return;
    settle(ctx(), function (value) {
      if (value && typeof value === "object") post(slug, { type: "wx-copilot-context", context: value });
    });
  }

  function declaredVerbs() {
    var intents = api.intents;
    if (!intents || typeof intents !== "object") return [];
    return Object.keys(intents).filter(function (verb) {
      return /^[a-z][a-z-]{0,31}$/.test(verb) && typeof intents[verb] === "function";
    });
  }

  // ── 与同页其它右下角挂件共存 ───────────────────────────────────────────────
  //
  // A host page may already carry another bottom-right launcher (the official
  // site runs the Chatwoot support bubble at the same corner). Two floating
  // docks on top of each other is the worst of both: the lower one looks broken
  // and cannot be clicked. Measured 2026-11-23 on www.finddatatech.cloud — the
  // 64px Chatwoot bubble sat exactly under this 420x80 dock.
  //
  // We do NOT try to merge the two products (they do different jobs). We just
  // get out of each other's way: when another kept-in-corner launcher is
  // present, shift this dock left by its width so both stay reachable.
  //
  // Detection is by known selectors, not "anything fixed in the corner" — a
  // random fixed element (a cookie bar, a chat from a third party) must not
  // push the dock around. The list is one entry today; adding a vendor means
  // adding its selector here, deliberately.
  var OTHER_DOCK_SELECTORS = [".woot-widget-bubble", "#chatwoot_live_chat_widget"];

  function otherDockWidth() {
    var gap = 0;
    for (var i = 0; i < OTHER_DOCK_SELECTORS.length; i += 1) {
      var el = document.querySelector(OTHER_DOCK_SELECTORS[i]);
      if (!el) continue;
      var r = el.getBoundingClientRect();
      // Only counts if it is actually rendered and sitting in the bottom-right
      // band this dock would occupy. A hidden or elsewhere-positioned widget
      // does not move us.
      if (r.width <= 0 || r.height <= 0) continue;
      if (window.innerWidth - r.right > 120) continue;
      if (window.innerHeight - r.bottom > 160) continue;
      if (r.width > gap) gap = r.width;
    }
    return gap;
  }

  // Apply (or clear) the offset at mount time and whenever the other widget
  // appears/disappears — it loads asynchronously and may arrive later (or after
  // a route change). One observer, disconnected when the dock is gone.
  var offsetObserver = null;
  function applyCoexistenceOffset() {
    if (!frame) return;
    var gap = otherDockWidth();
    frame.style.right = gap ? gap + 16 + "px" : "0px";
  }
  function watchOtherDocks() {
    if (offsetObserver || typeof MutationObserver !== "function") return;
    offsetObserver = new MutationObserver(function () { applyCoexistenceOffset(); });
    offsetObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", applyCoexistenceOffset);
  }

  function mount(slug, theme) {
    if (frame) return;
    var accent = ACCENT || theme || "";
    var q = [];
    if (accent) q.push("accent=" + encodeURIComponent(accent));
    if (TITLE) q.push("title=" + encodeURIComponent(TITLE));
    if (OPEN) q.push("open=1");

    frame = document.createElement("iframe");
    frame.src = ORIGIN + "/#/embed/" + encodeURIComponent(slug) + (q.length ? "?" + q.join("&") : "");
    frame.title = "助手";
    frame.setAttribute("allow", "clipboard-write");
    frame.setAttribute("data-wanxing-copilot", slug);
    // The widget draws its own launcher inside a transparent document, so the
    // iframe covers the dock area and floats over the host page.
    frame.style.cssText = [
      "position:fixed", "bottom:0", "right:" + (otherDockWidth() ? otherDockWidth() + 16 : 0) + "px", "width:420px",
      "height:" + (OPEN ? "640px" : "80px"),
      "max-width:100vw", "max-height:100vh", "border:0", "background:transparent",
      "z-index:2147483000", "color-scheme:normal", "transition:height .2s ease",
    ].join(";");

    // Host protocol: only our widget's origin AND our own frame are trusted.
    window.addEventListener("message", function (ev) {
      if (ev.origin !== ORIGIN || !frame || ev.source !== frame.contentWindow) return;
      var d = ev.data;
      if (!d || typeof d !== "object" || d.slug !== slug) return;

      if (d.type === "wx-copilot-ready") {
        emit("ready", { slug: slug });
        // Declare the verbs the host can actually execute. The widget renders
        // an intent as executable only when it was declared here — a host that
        // supplies no intents gets a plain question card, never a dead button.
        var verbs = declaredVerbs();
        post(slug, { type: "wx-copilot-init", intents: verbs });
        sendContext(slug);
        return;
      }

      if (d.type === "wx-copilot-identity-request") {
        emit("identity-request", {});
        var identify = hook("identify");
        if (!identify) {
          // No host identity: relay null and let the widget use its own tier
          // (anonymous if open, otherwise the login upgrade).
          emit("identity", { token: false });
          post(slug, { type: "wx-copilot-identity", token: null });
          return;
        }
        settle(identify(), function (value) {
          var token = (value && value.token) || null;
          emit("identity", { token: !!token });
          post(slug, { type: "wx-copilot-identity", token: token });
        });
        return;
      }

      if (d.type === "wx-copilot-state") {
        // Collapsed = a 48px launcher floating in a transparent document, so
        // the iframe must SHRINK with it — a full-height transparent frame
        // would silently eat the host page's clicks in that whole corner.
        emit("state", { open: d.open });
        frame.style.height = d.open ? "640px" : "80px";
        return;
      }

      if (d.type === "wx-copilot-intent") {
        emit("intent", { verb: d.verb, arg: d.arg });
        var handler = api.intents && api.intents[d.verb];
        var reply = function (ok, message) {
          post(slug, {
            type: "wx-copilot-intent-result",
            askId: d.askId, questionId: d.questionId, ok: !!ok,
            ...(message ? { message: String(message) } : {}),
          });
        };
        if (typeof handler !== "function") return reply(false, "当前页面不支持该动作");
        try {
          settle(handler(d.arg), function (value) {
            if (value === false) return reply(false, "动作未执行");
            reply(true, value && typeof value === "object" ? value.message : "");
          });
        } catch (e) {
          reply(false, String((e && e.message) || e));
        }
        return;
      }
    });

    // SPA route changes: hashchange/popstate are free; pushState is not, so the
    // host calls WanxingCopilot.pushContext() after its own navigation.
    window.addEventListener("hashchange", function () { sendContext(slug); });
    window.addEventListener("popstate", function () { sendContext(slug); });
    api.pushContext = function () { sendContext(slug); };

    document.body.appendChild(frame);
    // The other dock may load before or after us; watch and re-offset.
    applyCoexistenceOffset();
    watchOtherDocks();
  }


  // Silent warm-up: mint an anonymous visitor token, then send one throwaway
  // turn. Both calls are best-effort — this never surfaces an error, and it
  // never blocks mounting.
  function warmOnLoad(slug) {
    if (!slug) return;
    var base = ORIGIN + "/api/wanxing/v1/chat/" + encodeURIComponent(slug);
    var headers = { "content-type": "application/json" };
    // Origin travels automatically; the facade mints an anonymous credential
    // only for origins on the agent's allowlist, so an unlisted host simply
    // gets a 403 here and nothing happens.
    fetch(base + "/visitor-token", { method: "POST", mode: "cors", credentials: "omit", headers: { "content-type": "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (tok) {
        if (!tok || !tok.token) return;
        return fetch(base, {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + tok.token,
            // A fixed key: a reload must not warm twice (the facade dedupes on
            // it too, but keeping it stable also makes the intent obvious).
            "idempotency-key": "wx-warm:" + slug,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 0,
            method: "message/send",
            params: {
              message: {
                role: "user",
                parts: [{ kind: "text", text: "hi" }],
                context_id: "wx-warm:" + slug,
              },
            },
          }),
        });
      })
      .catch(function () { /* warming is never a failure mode */ });
  }

  if (!LINE) return warn("missing data-line");

  // Resolve the binding BEFORE mounting: the loader must not inject a surface
  // the facade cannot serve (D6).
  fetch(ORIGIN + "/api/wanxing/v1/lines/" + encodeURIComponent(LINE) + "/copilot", {
    mode: "cors",
    credentials: "omit",
  })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (doc) {
      if (!doc) return warn("resolution failed (HTTP error)");
      if (doc.state !== "ready" || !doc.agent || !doc.agent.slug) {
        return warn((doc.state || "unresolved") + (doc.reason ? " (" + doc.reason + ")" : ""));
      }
      var theme = (doc.theme && doc.theme.accent) || "";
      mount(doc.agent.slug, theme);
      // Warm the agent while the visitor is still reading the page.
      //
      // Measured 2026-11-18: the FIRST turn on an unvisited agent costs ~24s
      // (the runner spawns the dsh child on demand — there is no "start on
      // deploy", and AGENT_RUNNER_MAX_CHILDREN=8 means only the recently-used
      // ones stay hot). The second turn is ~7s. A visitor takes longer than
      // that to click the bubble and type, so firing one silent turn NOW
      // usually erases the wait entirely.
      //
      // Fire-and-forget on purpose: any failure (anon closed, quota, cold-start
      // error) is ignored — this is an optimisation, never a gate. The visitor's
      // real turn is unaffected either way.
      warmOnLoad(doc.agent.slug);
    })
    .catch(function () { warn("resolution request failed (network or CORS)"); });
})();
