# Design: fix-console-signout-sso

## Context

Console auth today (`wanxing-web/src/auth.js`):

- `teardownSession({ expired })` — best-effort `POST /console/auth/revoke` with the refresh token (RFC 7009 hygiene: "revocation is cleanup, never a gate"), then clears `wanxing-console-token/-refresh/-email` and emits state. Called from two places: the header 退出 button (`App.jsx`) and the expiry paths (renewal timer failure, `authFetch` 401 backstop).
- `loginLogto()` — fetches `/console/auth/config` (`{ app_id, endpoint }`) and redirects to `${endpoint}/oidc/auth` with PKCE + `prompt=consent`.

Because nothing ends the identity-provider session, the `auth.finddatatech.cloud` SSO cookie survives sign-out; the next 登录 re-enters without credentials. Live-verified 2026-10-06: the console's Logto app `b7rsugz1rtma13wcmubuc` already has `https://wanxing.finddatatech.cloud/` registered as post-sign-out redirect — an anonymous end-session confirm walk (cookie-jar, no browser session) returns `303 → https://wanxing.finddatatech.cloud/`, so no tenant configuration work is required.

## Goals / Non-Goals

Goals:
- The 退出 button ends the shared Logto SSO session and lands the browser on the site homepage (the intro view at `#/`), matching the other FindData surfaces' sign-out contract (壹座/谦面 both end the SSO session and return to their roots).

Non-Goals:
- No single-logout across products (killing the SSO cookie does not revoke other products' own app sessions — same behavior as 壹座/谦面; acknowledged SSO limitation).
- No backend/facade change, no new storage, no Logto tenant changes.
- Session-expiry flows stay as-is (on-page notice).

## Decisions

### D1: New `signOut()` in auth.js = teardown + redirect; the button is its only caller

```js
export async function signOut() {
  await teardownSession();                       // revoke + clear, as today
  const cfg = await fetch("/api/wanxing/v1/console/auth/config").then(r => r.json());
  const u = new URL(cfg.endpoint + "/oidc/session/end");
  u.searchParams.set("client_id", cfg.app_id);
  u.searchParams.set("post_logout_redirect_uri", window.location.origin + "/");
  window.location.href = u.toString();
}
```

Rationale for a separate function instead of an `endSso` flag on `teardownSession`: the two callers have opposite navigation contracts (button = leave the page; expiry = stay). A flag invites someone later to pass it from the expiry path. The expiry paths keep calling `teardownSession({ expired: true })` unchanged. Alternative rejected: redirecting first and revoking in a `beforeunload` — revocation would race page destruction and silently regress the RFC-7009 hygiene the facade spec calls out.

The config re-fetch on sign-out mirrors `loginLogto()` and keeps the endpoint/app-id out of the bundle; failure of the config fetch falls through the same `catch` shape as login (the user stays signed out locally — local teardown already ran — with an `alert` like the login error path).

### D2: Landing page is the site root

`post_logout_redirect_uri = window.location.origin + "/"` — the hash router renders the intro view. `window.location.origin` (not a hardcoded domain) keeps staging/preview deployments correct for free.

### D3: Ops-token sessions ride the same path

`teardownSession()` already handles the no-refresh-token case; the end-session redirect with no IdP session completes without error (verified pattern: the anonymous confirm walk returns `303` to the post-sign-out URI regardless of session state).

## Risks / Trade-offs

- The end-session hop is a cross-origin round trip; a Logto outage would leave sign-out hanging on the redirect. Accepted: the local teardown has already run by then, so the console is functionally signed out either way.
- Other products' sessions are untouched (no single logout) — same limitation every surface in this tenant already has; killing the shared cookie still stops the "one click back in" experience.
- `prompt=consent` on login means the return visit after sign-out shows the consent screen — correct (proof the SSO session died), slightly more friction than a silent re-auth.
