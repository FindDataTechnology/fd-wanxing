# Tasks: fix-console-signout-sso

## 1. Frontend sign-out chain

- [x] 1.1 Add `signOut()` to `wanxing-web/src/auth.js`: `await teardownSession()`, fetch `/api/wanxing/v1/console/auth/config`, build `${endpoint}/oidc/session/end?client_id=…&post_logout_redirect_uri=origin+"/"`, redirect. Verify: `npm run build` in wanxing-web passes.
- [x] 1.2 Switch the header 退出 button (`App.jsx`) to `onClick={() => void signOut()}`; leave the expiry callers on `teardownSession({ expired: true })` untouched. Verify: grep shows no other `teardownSession()` no-arg call sites.
- [ ] 1.3 Build + deploy wanxing-web (standard line; facade untouched). Verify: new wanxing-web live on `wanxing.finddatatech.cloud`.

## 2. Live verification

- [ ] 2.1 Real browser: sign in → 退出 → land on the intro homepage signed out; confirm the Logto end-session hop happened. Verify: manual walkthrough, screenshot in change notes.
- [ ] 2.2 Re-login after sign-out shows the credential/consent flow (no silent re-entry) — proves the SSO session died. Verify: manual observation.
- [ ] 2.3 Expiry path still on-page: simulate a stale refresh token (clear `wanxing-console-refresh` or force a 401) → login card with 登录已过期 notice, no redirect. Verify: manual or console-driven check.
- [ ] 2.4 Ops-token session: set an ops token, sign out — no error, redirect completes to homepage. Verify: manual check.
