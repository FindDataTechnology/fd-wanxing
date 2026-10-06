## ADDED Requirements

### Requirement: Console sign-out ends the identity-provider session

The console's explicit sign-out action SHALL first perform the existing local teardown (best-effort refresh-token revocation, storage clear) and then redirect the browser to the Logto end-session endpoint with the console's client id and the site's registered post-sign-out redirect, terminating the shared SSO session and returning the browser to the site homepage. Session-expiry teardown (failed renewal, 401 backstop) SHALL clear local state and stay on the page without redirecting.

#### Scenario: explicit sign-out ends the SSO session

- **WHEN** a signed-in deployer activates the console's 退出 action
- **THEN** the browser ends up on the site homepage with local credentials cleared, and the Logto session at the identity provider no longer auto-authenticates the next login

#### Scenario: expiry teardown does not redirect

- **WHEN** the session is torn down by the renewal timer or a 401 refresh failure
- **THEN** local credentials are cleared and the login card is shown on the current page, with no navigation to the identity provider

#### Scenario: ops-token sessions sign out cleanly

- **WHEN** a console authenticated with an ops service token activates the sign-out action
- **THEN** local state is cleared and the end-session redirect completes without error even though no refresh token exists
