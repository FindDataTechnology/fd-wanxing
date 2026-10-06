# Tasks: fix-console-signout-sso

## 1. Frontend sign-out chain

- [x] 1.1 Add `signOut()` to `wanxing-web/src/auth.js`: `await teardownSession()`, fetch `/api/wanxing/v1/console/auth/config`, build `${endpoint}/oidc/session/end?client_id=…&post_logout_redirect_uri=origin+"/"`, redirect. Verify: `npm run build` in wanxing-web passes.
- [x] 1.2 Switch the header 退出 button (`App.jsx`) to `onClick={() => void signOut()}`; leave the expiry callers on `teardownSession({ expired: true })` untouched. Verify: grep shows no other `teardownSession()` no-arg call sites.
- [x] 1.3 Build + deploy wanxing-web (standard line; facade untouched). Verify: new wanxing-web live on `wanxing.finddatatech.cloud`. Done 2026-10-06: image sha-4b5c24b via GHA (after a GitHub Actions outage retry), GitOps 503c3ca rolled, bundle `assets/index-jyD09Rlb.js` serving with session/end code confirmed.

## 2. Live verification

- [x] 2.1 Real browser: sign in → 退出 → land on the intro homepage signed out; confirm the Logto end-session hop happened. PASS 2026-10-06 (Logto recovered): passwordless login (surviving SSO) → real click on 退出 → localStorage cleared → landed `https://wanxing.finddatatech.cloud/` (intro homepage) with header back to 登录. The transient end-session URL is too fast for automation polling to capture now that Logto answers immediately; the first (hung-Logto) run had already captured the exact redirect URL `…/oidc/session/end?client_id=b7rsugz1rtma13wcmubuc&post_logout_redirect_uri=…`.
- [x] 2.2 Re-login after sign-out shows the credential/consent flow (no silent re-entry) — proves the SSO session died. PASS 2026-10-06: clicking 登录 after sign-out lands on `auth.finddatatech.cloud/sign-in?app_id=b7rsugz1rtma13wcmubuc` with the Username/Email + password form — no passwordless re-entry.
- [x] 2.3 Expiry path still on-page: PASS 2026-10-06 — planted a stale token pair (token exp in the past + bogus refresh) and reloaded #/console: renewal fired and failed, storage cleared, a login card dropped onto the spot with the 登录已过期，请重新登录 notice, URL unchanged (no navigation to the IdP).
- [x] 2.4 Ops-token session: PASS 2026-10-06 — token-only session (no refresh/email) → 退出 → clean teardown (revoke skipped, no refresh token) → landed on the homepage signed out, no error.
