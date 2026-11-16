// Shared console auth (add-console-session-continuity): Logto PKCE login,
// silent renewal over a rotating refresh token (proxied by the facade), and
// the subscription store the header's 登录/控制台 switch rides. Credentials
// live in localStorage — cross-tab, cross-day sessions; tenant-side rotation
// bounds a stolen token's usefulness. The ops service-token channel stays
// outside all of this: it never expires and never refreshes.
import { useEffect, useState } from "react";

const TOKEN_KEY = "wanxing-console-token";
const REFRESH_KEY = "wanxing-console-refresh";
const EMAIL_KEY = "wanxing-console-email";
const VERIFIER_KEY = "wx-pkce-verifier";
const STATE_KEY = "wx-pkce-state";
const GATE_KEY = "wx-login-gate"; // "console" (default) | "chat" — the exchange's allowlist mode
const RETURN_KEY = "wx-login-return"; // hash to land on after the callback
// Embed popup login (add-embed-copilot-lane D4): set by the embed view in the
// IFRAME's sessionStorage before window.open — the auxiliary window inherits
// a copy, so the callback can see the mode and the embedding origin to
// postMessage the credential back to. The popup's own storage is the
// UNPARTITIONED wanxing bucket; writing there would fake a console login.
export const EMBED_MODE_KEY = "wx-embed-mode";
export const EMBED_PARENT_KEY = "wx-embed-parent";
export const EMBED_AUTH_MESSAGE = "wx-embed-auth";
const LOCK_NAME = "wanxing-auth-refresh"; // serializes rotation across tabs
const EXPIRED_NOTICE = "登录已过期，请重新登录";

const listeners = new Set();
let notice = "";

const emit = () => {
  scheduleRenewal();
  for (const fn of listeners) fn(authState());
};

const tokenExpMs = (token) => {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const exp = Number(JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))).exp) * 1000;
    return Number.isFinite(exp) ? exp : 0;
  } catch {
    return 0; // unreadable token: not ours to schedule (opaque ops token)
  }
};

// `signedIn` is the header's truth, and it is NOT "a token string exists"
// (2026-11-16). It used to be exactly that, which is how a session whose
// id_token expired 32 days earlier still painted 邮箱 · 退出 over a dead
// credential — the page claimed an identity it could no longer use. An
// expired id_token with a refresh grant is still recoverable, so it stays
// stored (renewal needs it); it just must not read as signed in.
// An opaque token (the ops service-token channel) has no exp claim and is
// treated as signed in — it never expires by design.
export const authState = () => {
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const exp = token ? tokenExpMs(token) : 0;
  return {
    token,
    refresh: localStorage.getItem(REFRESH_KEY) || "",
    email: localStorage.getItem(EMAIL_KEY) || "",
    signedIn: Boolean(token) && (!exp || exp > Date.now()),
    tokenExpired: Boolean(token) && Boolean(exp) && exp <= Date.now(),
    notice,
  };
};

// React seam: one subscription per component.
export function useAuth() {
  const [state, setState] = useState(authState);
  useEffect(() => subscribeAuth(setState), []);
  return state;
}

export const subscribeAuth = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

window.addEventListener("storage", emit); // another tab wrote credentials

const b64u = (buf) => btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Start the PKCE redirect. The SPA builds the authorize URL itself (the face
// is static); keep scope/prompt in exact lockstep with logto-auth's
// authorizeUrl — offline_access + prompt=consent is what makes the tenant
// issue the rotating refresh token. Options: gate "chat" exchanges the code
// WITHOUT the console allowlist (the chat lane admits any tenant identity);
// returnTo lands the callback back on that hash instead of the console.
export async function loginLogto({ gate = "console", returnTo = null } = {}) {
  window.location.href = await prepareLogin({ gate, returnTo });
}

// Build the PKCE authorize URL and park the one-shot state in sessionStorage
// (the callback reads it back). Shared by the redirect login above and the
// embed popup login (D4): embedParent marks embed mode so the callback
// postMessages the credential to its opener instead of persisting it.
export async function prepareLogin({ gate = "console", returnTo = null, embedParent = null } = {}) {
  const cfg = await fetch("/api/wanxing/v1/console/auth/config").then(async (r) => {
    if (!r.ok) throw new Error("identity not configured on this deployment");
    return r.json();
  });
  const verifier = b64u(crypto.getRandomValues(new Uint8Array(48)));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(GATE_KEY, gate === "chat" ? "chat" : "console");
  sessionStorage.setItem(RETURN_KEY, returnTo ?? "#/console");
  if (embedParent) {
    sessionStorage.setItem(EMBED_MODE_KEY, "1");
    sessionStorage.setItem(EMBED_PARENT_KEY, embedParent);
  } else {
    sessionStorage.removeItem(EMBED_MODE_KEY);
    sessionStorage.removeItem(EMBED_PARENT_KEY);
  }
  const challenge = b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = String(Math.random()).slice(2, 10);
  sessionStorage.setItem(STATE_KEY, state);
  const u = new URL(cfg.endpoint + "/oidc/auth");
  u.searchParams.set("client_id", cfg.app_id);
  u.searchParams.set("redirect_uri", window.location.origin + "/console-callback");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile offline_access");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

// /console-callback landing: exchange through the facade proxy, keep the
// token pair, land where the login asked for (default: the console). State
// is now checked (it never was).
export async function handleConsoleCallback() {
  const q = new URLSearchParams(window.location.search);
  const code = q.get("code");
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const state = sessionStorage.getItem(STATE_KEY);
  const gate = sessionStorage.getItem(GATE_KEY) === "chat" ? "chat" : "console";
  const returnTo = sessionStorage.getItem(RETURN_KEY) || "#/console";
  // Embed popup mode (D4): inherited sessionStorage copy from the iframe.
  const embedMode = sessionStorage.getItem(EMBED_MODE_KEY) === "1";
  const embedParent = sessionStorage.getItem(EMBED_PARENT_KEY) || "";
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(GATE_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  sessionStorage.removeItem(EMBED_MODE_KEY);
  sessionStorage.removeItem(EMBED_PARENT_KEY);
  window.wxLoginReturnTo = returnTo; // main.jsx lands there after this settles
  if (!code || !verifier || !state || q.get("state") !== state) return;
  const r = await fetch("/api/wanxing/v1/console/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, verifier, redirect_uri: window.location.origin + "/console-callback", gate }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  const d = await r.json();
  if (embedMode) {
    // Hand the credential to the opener (the embed iframe) and never touch
    // this window's storage: the popup lives in the unpartitioned bucket, the
    // iframe in its partitioned one — only postMessage bridges them. The
    // target origin is the IFRAME's origin (ours): the iframe is the opener.
    window.wxEmbedDone = true;
    try {
      window.opener?.postMessage(
        { type: EMBED_AUTH_MESSAGE, id_token: d.id_token, refresh_token: d.refresh_token ?? null, email: d.email ?? "", parent: embedParent },
        window.location.origin,
      );
    } catch { /* an opener that went away leaves the user with the notice below */ }
    document.body.innerHTML = '<p style="font-family:system-ui,sans-serif;padding:24px;color:#334155">登录成功——本窗口即将自动关闭。</p>';
    setTimeout(() => window.close(), 600);
    return;
  }
  localStorage.setItem(TOKEN_KEY, d.id_token);
  localStorage.setItem(EMAIL_KEY, d.email);
  if (d.refresh_token) localStorage.setItem(REFRESH_KEY, d.refresh_token);
  notice = "";
  emit();
}

// Ops channel: service token only — no refresh grant, no email.
export const setOpsToken = (token) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EMAIL_KEY);
  notice = "";
  emit();
};

// One refresh grant against the facade proxy. Success = the stored pair
// changed (rotation) — another tab may have done the work under the lock.
const refreshOnce = async () => {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  const r = await fetch("/api/wanxing/v1/console/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!r.ok) return false;
  const d = await r.json();
  if (!d.id_token || !d.refresh_token) return false;
  localStorage.setItem(TOKEN_KEY, d.id_token);
  localStorage.setItem(REFRESH_KEY, d.refresh_token);
  return true;
};

let inflight = null;

// Serialized renewal: the tenant rotates refresh tokens, so two tabs racing
// would kill each other's grant. Web Locks mutex + re-read inside the lock
// converges both tabs onto the same rotated pair.
export function renewSession() {
  inflight ??= (async () => {
    const myRefresh = localStorage.getItem(REFRESH_KEY);
    const myToken = localStorage.getItem(TOKEN_KEY);
    const attempt = async () => {
      try {
        await refreshOnce();
      } catch { /* state decides below */ }
      return Boolean(localStorage.getItem(TOKEN_KEY)) &&
        (localStorage.getItem(REFRESH_KEY) !== myRefresh || localStorage.getItem(TOKEN_KEY) !== myToken);
    };
    try {
      if (navigator.locks?.request) return await navigator.locks.request(LOCK_NAME, attempt);
      return await attempt();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Session teardown: best-effort revocation (cleanup, never a gate — RFC
// 7009), then clear everything. `expired` records why for the login card.
export async function teardownSession({ expired = false } = {}) {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (refreshToken) {
    try {
      await fetch("/api/wanxing/v1/console/auth/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: refreshToken }),
      });
    } catch { /* best-effort by contract */ }
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EMAIL_KEY);
  notice = expired ? EXPIRED_NOTICE : "";
  emit();
}

// Explicit sign-out (the header 退出 button's only caller): local teardown
// first, then end the shared Logto SSO session and land on the site homepage.
// The expiry paths deliberately keep calling teardownSession alone — a dead
// session must not bounce the user off the page they are on.
export async function signOut() {
  await teardownSession();
  try {
    const cfg = await fetch("/api/wanxing/v1/console/auth/config").then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    const u = new URL(cfg.endpoint + "/oidc/session/end");
    u.searchParams.set("client_id", cfg.app_id);
    u.searchParams.set("post_logout_redirect_uri", window.location.origin + "/");
    window.location.href = u.toString();
  } catch (e) {
    // The console is already signed out at this point (teardown ran); only
    // the IdP hop failed — surface it the same way login errors do.
    alert(String(e?.message || e));
  }
}

// Renewal timer: fire five minutes before the id_token dies. Background-tab
// throttling can delay the timer; the 401 path in authFetch is the backstop.
let timer = null;

// Renewal timer, and the boot arming that used to be missing (2026-11-16).
//
// The ONLY caller of scheduleRenewal used to be emit(), which fires on login
// callback, cross-tab storage writes and sign-out — never on page load. So a
// tab opened against an existing localStorage session armed nothing: the
// id_token expired silently and the console kept painting a signed-in header
// over an expired credential. The user's only cure was signing out and back
// in, which is exactly the "every upgrade needs a re-login" report.
//
// Two halves, both required:
//   · arm on boot for a still-valid token (scheduleRenewal below handles the
//     future expiry);
//   · renew IMMEDIATELY when the stored token is already expired — a timer at
//     zero delay would do the same thing, but doing it up front means the very
//     first paint and the first gated call see a fresh credential.
// An id_token without a refresh grant (the ops service-token channel) is left
// alone: nothing can renew it and it never expires.

async function armRenewalOnBoot() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || !localStorage.getItem(REFRESH_KEY)) return;
  const exp = tokenExpMs(token);
  if (!exp) return;
  if (exp <= Date.now()) {
    // Already dead: renew now. A failure is NOT an automatic teardown — the
    // surrounding surfaces degrade on their own 401s, and a transient /refresh
    // (facade restart, network) must not sign the user out of a page they are
    // reading. authFetch still tears down on a definitive 401-after-refresh.
    await renewSession().catch(() => false);
    return;
  }
  scheduleRenewal();
}

export function scheduleRenewal() {
  clearTimeout(timer);
  timer = null;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || !localStorage.getItem(REFRESH_KEY)) return;
  const exp = tokenExpMs(token);
  if (!exp) return;
  timer = setTimeout(async () => {
    if (!(await renewSession()) && localStorage.getItem(TOKEN_KEY)) await teardownSession({ expired: true });
  }, Math.max(0, exp - Date.now() - 5 * 60_000));
  // Do not hold the process open: in a browser this is inert, in node (tests,
  // any future SSR/pre-render) an armed hour-long timer would keep the event
  // loop alive and stall the run. The timer still fires if the process is
  // otherwise busy; it simply stops being a reason to stay alive.
  timer?.unref?.();
}

// Arm at module load (side effect, next to the `storage` subscription above):
// the SPA is a single entry point, so every route gets the boot arming without
// a component having to remember. Fire-and-forget; failures are silent here.
void armRenewalOnBoot();

// Test seam: the boot arming runs once at import. Tests that need to observe
// the expired-token path call this directly rather than re-importing.
export { armRenewalOnBoot };

// Credentialed fetch for every console/fleet call: bearer from storage, and
// on 401 one refresh-and-retry before giving up. A failed renewal tears the
// session down (the login card takes over); the ops service token — no
// refresh grant — passes 401s through untouched.
export async function authFetch(url, options = {}) {
  const call = () =>
    fetch(url, {
      ...options,
      headers: { ...(options.headers ?? {}), Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` },
    });
  let r = await call();
  if (r.status === 401 && localStorage.getItem(REFRESH_KEY) && localStorage.getItem(TOKEN_KEY)) {
    if (!(await renewSession())) {
      await teardownSession({ expired: true });
    } else {
      r = await call();
    }
  }
  return r;
}
