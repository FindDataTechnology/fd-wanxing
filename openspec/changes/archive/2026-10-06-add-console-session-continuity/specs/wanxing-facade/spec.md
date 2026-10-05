# wanxing-facade 变更（delta）

## ADDED Requirements

### Requirement: Console session endpoints proxy token refresh and revocation

The facade SHALL proxy the tenant OIDC token lifecycle for the console's public client: `POST /api/wanxing/v1/console/auth/refresh` accepts `{ refresh_token }`, exchanges it at the tenant token endpoint (`grant_type=refresh_token`), verifies the returned id_token under the same fail-closed gate as login (JWKS/ES384, issuer/audience/expiry, email allowlist), and returns `{ id_token, refresh_token, email }` — rotation-aware: whichever refresh token the tenant issued is the one returned. `POST /api/wanxing/v1/console/auth/revoke` accepts `{ token }` and best-effort revokes it at the tenant revocation endpoint (`/oidc/token/revocation`), responding ok regardless of upstream outcome (RFC 7009 semantics — revocation is cleanup, never a gate). Both endpoints exist only when Logto is configured; otherwise they respond 503.

#### Scenario: refresh rotates and re-verifies

- **WHEN** a valid refresh token is posted to the refresh proxy
- **THEN** the facade verifies the newly issued id_token against the allowlist and returns the new token pair with the caller's email

#### Scenario: refused identity on refresh

- **WHEN** the refreshed id_token fails verification or the allowlist
- **THEN** the refresh proxy responds 403 and returns no tokens

#### Scenario: revoke is best-effort

- **WHEN** a token is posted to the revoke proxy and the tenant is slow or unreachable
- **THEN** the facade still responds ok (the client clears local state regardless)

#### Scenario: unconfigured deployment

- **WHEN** Logto identity is not configured
- **THEN** both endpoints respond 503 and the legacy exchange/config routes stay absent

### Requirement: Fleet reads pass through the facade under the console gate

The browser-facing fleet observation reads — `GET /api/fleet/v1/board` and `GET /api/fleet/v1/agents/:slug/timeline` — SHALL be served by the facade behind the same dual gate as the console management routes (ops service token, or a verified Logto identity with fail-closed email allowlist). Admitted requests SHALL be forwarded to the observer (`FLEET_OBSERVER_URL`) with the observer service credential (`FLEET_OBSERVER_TOKEN`) as bearer, response status and body passed through. The web face's nginx SHALL route `/api/fleet/` to the facade (not the observer). The observer itself SHALL stay credential-only and unchanged — runners posting `/ingest` and ops-consumers reading the observer directly are unaffected.

#### Scenario: identity holder reads the board

- **WHEN** a caller with a verified allowlisted Logto identity requests `/api/fleet/v1/board` through the web face
- **THEN** the facade admits the request, forwards it with the observer service credential, and the board payload renders

#### Scenario: service credential still accepted

- **WHEN** the ops service token is presented to a fleet read
- **THEN** the facade admits and forwards it the same way

#### Scenario: unauthenticated fleet read

- **WHEN** a fleet read arrives with neither a service token nor a verified identity
- **THEN** the facade responds 401 before contacting the observer

#### Scenario: observer unreachable

- **WHEN** an admitted fleet read cannot reach the observer
- **THEN** the facade responds 502 with a diagnostic error, not the observer's credential challenge
