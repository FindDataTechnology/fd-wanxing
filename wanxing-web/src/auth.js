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
const LOCK_NAME = "wanxing-auth-refresh"; // serializes rotation across tabs
const EXPIRED_NOTICE = "登录已过期，请重新登录";

const listeners = new Set();
let notice = "";

const emit = () => {
  scheduleRenewal();
  for (const fn of listeners) fn(authState());
};

export const authState = () => ({
  token: localStorage.getItem(TOKEN_KEY) || "",
  refresh: localStorage.getItem(REFRESH_KEY) || "",
  email: localStorage.getItem(EMAIL_KEY) || "",
  notice,
});

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
// issue the rotating refresh token.
export async function loginLogto() {
  const cfg = await fetch("/api/wanxing/v1/console/auth/config").then(async (r) => {
    if (!r.ok) throw new Error("identity not configured on this deployment");
    return r.json();
  });
  const verifier = b64u(crypto.getRandomValues(new Uint8Array(48)));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
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
  window.location.href = u.toString();
}

// /console-callback landing: exchange through the facade proxy, keep the
// token pair, land on the console. State is now checked (it never was).
export async function handleConsoleCallback() {
  const q = new URLSearchParams(window.location.search);
  const code = q.get("code");
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const state = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (!code || !verifier || !state || q.get("state") !== state) return;
  const r = await fetch("/api/wanxing/v1/console/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, verifier, redirect_uri: window.location.origin + "/console-callback" }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  const d = await r.json();
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

export function scheduleRenewal() {
  clearTimeout(timer);
  timer = null;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || !localStorage.getItem(REFRESH_KEY)) return;
  let exp = 0;
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    exp = Number(JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))).exp) * 1000;
  } catch {
    return;
  }
  timer = setTimeout(async () => {
    if (!(await renewSession()) && localStorage.getItem(TOKEN_KEY)) await teardownSession({ expired: true });
  }, Math.max(0, exp - Date.now() - 5 * 60_000));
}

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
