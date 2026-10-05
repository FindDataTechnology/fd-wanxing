# Proposal: fix-console-signout-sso

## Why

The 萬星 console's 退出 button only tears down app-local state (best-effort refresh-token revoke + `localStorage` clear). The Logto SSO session at `auth.finddatatech.cloud` — shared by every FindData product in the browser — is never ended, so signing back in requires no password (one click through the PKCE authorize) and every other product stays logged in. Users read this as "sign out doesn't work". Live-probed 2026-10-06: the console's Logto app (`b7rsugz1rtma13wcmubuc`) already has `https://wanxing.finddatatech.cloud/` registered as its post-sign-out redirect (end-session confirm walk returns `303` there), so the fix is pure frontend.

## What Changes

- The console header's 退出 action, after the existing local teardown (revoke + storage clear), redirects the browser to Logto's end-session endpoint (`client_id` + `post_logout_redirect_uri=https://wanxing.finddatatech.cloud/`), ending the shared SSO session and landing on the site's intro homepage.
- Expiry-driven teardown (401/refresh-failure paths) does NOT redirect — only the explicit button ends the SSO session; an expired session keeps the user on the page with the existing "登录已过期" notice.
- No backend change: the facade already serves `/console/auth/config` (endpoint + app id) and the revoke route; the Logto tenant needs no configuration (redirect already registered, verified live).
- Out of scope: 壹座's sign-out dead-route regression (paas repo change `fix-web-signout-dead-route`); 谦面/facet was probed working end-to-end and is untouched.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `wanxing-web`: add a requirement that console sign-out ends the identity-provider session — the explicit sign-out action terminates the Logto SSO session and returns the browser to the site homepage, while session-expiry teardown stays on-page.

## Impact

- `wanxing-web/src/auth.js`: one new exported function (teardown + end-session redirect); `wanxing-web/src/App.jsx`: the 退出 button calls it.
- The facade's `/console/auth/config` is fetched again at sign-out (already used at login); no new API surface.
- Verification: real browser — sign in, sign out, confirm the auth.finddatatech.cloud session cookie is gone and re-login shows the credential/consent flow; ops-token sessions still sign out without error.
