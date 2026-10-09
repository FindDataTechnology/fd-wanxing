# wanxing-web Specification

## Purpose

The Wanxing web face at the Wanxing domain: a human-browsable public agent
catalog, the in-site integration one-pager, and the deployer console (fleet
visibility + management actions) behind deployer authentication. It also
serves the visitor chat view for chatable agents and the deployer's
invocation-records and host-allowance console panels.

## Requirements

### Requirement: The public catalog page lists agents for humans

The Wanxing web face SHALL serve a public catalog page (no credential) that lists public agents from the facade's catalog API with pagination and client-side search over the loaded page, each entry showing name, description, version, and tags.

#### Scenario: anonymous browse

- **WHEN** a visitor opens the catalog page
- **THEN** public agents render as cards with pagination controls, and typing in the search box filters the loaded page

#### Scenario: catalog API unreachable degrades visibly

- **WHEN** the facade catalog API fails or is unconfigured
- **THEN** the page shows an explicit error state, never an empty list masquerading as "no agents"

### Requirement: The docs face carries the integration one-pager

The web face SHALL render the caller integration essentials (auth by caller key, idempotency header, per-minute billing, error-code table, message/send example) as an in-site page, so an external integrator can start without leaving the domain.

#### Scenario: integrator onboarding

- **WHEN** a visitor opens the docs page
- **THEN** auth, idempotency, billing, and the error-code table are present

### Requirement: The deployer console authenticates deployers (Logto PKCE, ops token fallback)

The console view SHALL offer Logto login as the primary gate — SPA PKCE via the tenant OIDC, code exchanged through the facade proxy (no browser CORS on the token endpoint), ID token verified server-side (JWKS/ES384, issuer/audience/expiry) against a fail-closed email allowlist — with the ops service token retained as a secondary channel. Authenticated views cover the fleet board, per-agent timeline drill-down, and management actions (deployments list with pause/resume, per-agent caller allowlist).

#### Scenario: identity login

- **WHEN** a deployer signs in with an allowlisted Logto identity
- **THEN** the console renders board, timeline, and management surfaces under that identity, and unauthenticated requests to console routes are refused

#### Scenario: ops token fallback

- **WHEN** the ops service token is entered instead
- **THEN** the same surfaces render; a token-less visitor sees only the login view

#### Scenario: timeline drill-down

- **WHEN** an agent is selected with a valid credential
- **THEN** its lifecycle events render newest-first

### Requirement: The public intro view is the default landing

The web face SHALL serve a public, credential-free intro view at the hash root
`#/` as the default landing: a static, Chinese-first product introduction —
value-positioning hero with entry CTAs into the catalog and docs views, three
feature cards (service catalog / A2A calling / metering and billing), a
one-line how-it-works flow, and the caller quick facts. The quick facts SHALL
render the A2A call sample from the same shared component the docs view uses
(single source; the two surfaces cannot drift). The catalog SHALL remain
reachable at `#/catalog` with its tab; the `#/` semantic change from catalog to
intro is deliberate (first-visit orientation first). The intro view SHALL be
fully static — no catalog or fleet live data, no loading or empty states — and
the footer SHALL link the official site's constellation line page
(`/zh/products/constellation`).

#### Scenario: first visit lands on the intro

- **WHEN** a visitor opens the Wanxing domain root without a hash
- **THEN** the intro view renders as the landing with CTAs into the catalog and docs, and no credential is required

#### Scenario: catalog remains one click away

- **WHEN** a visitor on the intro view clicks the catalog tab or the hero CTA
- **THEN** the catalog view renders at `#/catalog` with its existing behavior unchanged

#### Scenario: the A2A sample has a single source

- **WHEN** the docs view and the intro view both render the call sample
- **THEN** both render from the same shared component, so the two surfaces cannot drift

#### Scenario: intro stays static

- **WHEN** the catalog API or fleet data is unreachable or slow
- **THEN** the intro view renders identically, with no loading state and no dependency on any live API

### Requirement: The site footer carries the five-line ladder

The site footer, shared by the three content views (intro, catalog, docs), SHALL render a 寻数产品线 ladder as a text figure: one row per line carrying the line's two-character mark (壹座, 识律, 柏讯, 谦面, 萬星), the ladder number written as the Chinese numeral (一, 十, 百, 千, 万 — per the naming contract 壹=1, 识=10, 柏=100, 谦=1000, 萬=10000), and the contract Chinese line name, with the constellation row marked 当前站点. Each row SHALL link to that line's official page (`https://www.finddatatech.cloud/zh/products/<line>/`). The figure SHALL be plain text with no image assets and SHALL wrap without horizontal overflow at narrow viewports. The console view SHALL NOT render the ladder (it carries only the compliance line — see the footer statements requirement).

#### Scenario: ladder present on every view

- **WHEN** a visitor opens any of the three content views (intro, catalog, docs)
- **THEN** the footer renders the five rows 一 壹座, 十 识律, 百 柏讯, 千 谦面, 万 萬星 with the constellation row marked 当前站点

#### Scenario: rows link to the line pages

- **WHEN** a visitor follows a ladder row
- **THEN** it targets that line's official page under `/zh/products/<line>/`

#### Scenario: naming contract taken verbatim

- **WHEN** the ladder renders a line
- **THEN** its Chinese numeral, contract line name, and character mark match the naming contract verbatim

#### Scenario: narrow viewport wraps

- **WHEN** the viewport is 375px wide
- **THEN** the ladder rows render without horizontal overflow

### Requirement: The site footer carries brand, contact, mission, and filing statements

On the three content views (intro, catalog, docs) the site footer SHALL carry: (a) the brand block — the two-character mark 萬星, the name 萬星, and the positioning line Agent 服务的对外运行与服务平台; (b) a contact block labeled 联系 with the email `1253774197@qq.com` as a `mailto:` link and the phone `17753221425` as a `tel:` link; (c) an entries column — intro, catalog, docs, console, and the official site's constellation line page (`/zh/products/constellation/`); (d) the company mission sentence 寻数科技聚焦AI时代下的文本和数据处理的基础设施建设，致力于推动信息平权，最终促进社会公平。 as a full-width text line; and (e) a copyright line (© 2026 寻数（FindData）· 萬星 Constellation) alongside both filing statements as text links — the ICP filing `粤ICP备2026118740号-1` to `https://beian.miit.gov.cn/` and the public-security filing `粤公网安备44030002016558号` to the public-security query platform (`https://www.mps.gov.cn/`), with no badge image. The console view SHALL render only the compliance line (e) — copyright plus both filing links as a single slim row — carrying none of the marketing blocks (a)–(d). The footer SHALL stay static — no live fleet or catalog data.

#### Scenario: brand, contact, and entries present

- **WHEN** the footer renders on a content view (intro, catalog, or docs)
- **THEN** it shows the brand block with the positioning line, the contact block with the mailto and tel links, and the entries column

#### Scenario: mission sentence present

- **WHEN** the footer renders on a content view
- **THEN** the mission sentence renders verbatim as a full-width line

#### Scenario: both filing statements are linked

- **WHEN** the footer renders
- **THEN** `粤ICP备2026118740号-1` links to the MIIT filing site and `粤公网安备44030002016558号` links to the public-security query platform

#### Scenario: footer stays static

- **WHEN** the catalog API or fleet data is unreachable or slow
- **THEN** the footer renders identically, with no loading state

#### Scenario: console carries only the compliance line

- **WHEN** the console view renders
- **THEN** the footer shows the copyright line and both filing links, and none of the brand block, contact block, entries column, mission sentence, or five-line ladder

### Requirement: The site header carries the single-character site mark

The header SHALL render the site mark as a text character block (a styled square rendered from text, no image asset): the single character 萬 beside the name 萬星 and the existing subtitle. The footer brand block and the ladder rows SHALL use the two-character mark 萬星, and no SVG or raster mark asset SHALL be added.

#### Scenario: header mark is the single character

- **WHEN** a visitor views the header on any view
- **THEN** the site mark renders as the single character 萬 beside 萬星

#### Scenario: marks carry no image asset

- **WHEN** the site renders
- **THEN** the marks are text, with no image request and no mark asset added to the bundle

### Requirement: Console sessions renew silently and expire visibly

The console session SHALL survive id_token expiry: the Logto authorization request SHALL request `offline_access`, the exchange proxy's refresh_token SHALL be stored alongside the id_token (both in localStorage), and the web face SHALL renew silently — a timer fires at expiry minus five minutes, and any 401 from a credentialed console/fleet call triggers one refresh-and-retry before surfacing the error. Renewal SHALL be serialized across tabs via Web Locks (the tenant rotates refresh tokens). When renewal fails (refresh token expired, revoked, or refused), the web face SHALL clear both tokens and fall back to the login view with the message 登录已过期，请重新登录 — no automatic re-redirect. Logout SHALL best-effort revoke the refresh token through the facade before clearing local credentials.

#### Scenario: silent renewal before expiry

- **WHEN** a logged-in tab approaches id_token expiry (five minutes prior)
- **THEN** the web face refreshes through the facade, stores the rotated pair, and no surface errors

#### Scenario: 401 triggers one refresh-and-retry

- **WHEN** a credentialed call returns 401 and the refresh token is still valid
- **THEN** the web face refreshes once, retries the call, and the user sees no re-login

#### Scenario: renewal failure falls back to the login card

- **WHEN** the refresh token is expired, revoked, or refused
- **THEN** both tokens are cleared, the console shows the login view with 登录已过期，请重新登录, and no automatic redirect fires

#### Scenario: logout revokes and clears

- **WHEN** the user exits (header chip or any exit control)
- **THEN** the web face best-effort revokes the refresh token via the facade and clears both tokens from localStorage

#### Scenario: multi-tab renewal is serialized

- **WHEN** two tabs attempt renewal concurrently
- **THEN** Web Locks serializes them and only one refresh grant reaches the tenant; both tabs end with the same rotated token pair

### Requirement: The header reflects login state

The site header SHALL reflect the console login state: logged out, the navigation shows a 登录 entry that starts the Logto PKCE redirect directly (no intermediate console card hop); logged in, the navigation shows the 控制台 entry plus an identity chip (email · 退出). The console view's in-page duplicate exit control SHALL be removed. The 登录/控制台 entries and the chip SHALL NOT appear on the public views' navigation beyond the header itself (intro, catalog, docs stay unauthenticated).

#### Scenario: logged-out header offers direct login

- **WHEN** a visitor without console credentials views any page
- **THEN** the navigation shows 登录 instead of 控制台, and clicking it starts the Logto redirect immediately

#### Scenario: logged-in header shows identity and exit

- **WHEN** console credentials are present
- **THEN** the navigation shows 控制台 and the email · 退出 chip, and the console view carries no duplicate exit control

#### Scenario: exit hands off to session teardown

- **WHEN** the 退出 control is used
- **THEN** the session teardown behavior of the renewal requirement applies (best-effort revocation, credentials cleared)

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

### Requirement: The chat view lets logged-in visitors converse with a chatable agent

The web face SHALL serve a chat view at `#/chat/:slug` for public agents: a visitor login gate (the tenant identity login, reused from the console's auth plumbing), the agent's name and description, a remaining-allowance display (today's subsidy and the agent's host pool, minutes with an approximate-turn hint), a message input with streamed replies (SSE), and conversation history held client-side only — the server persists no conversation content. When the lane answers the allowance-exhausted error, the view SHALL render the exhaustion state with an own-key continuation input: a pasted caller key stored client-side, after which turns ride the API lane as that key's caller. A not-chatable agent SHALL render an explicit not-open state, never an empty chat masquerading as unavailable.

#### Scenario: A logged-in visitor chats with streaming

- **WHEN** a verified visitor sends a message to a chatable agent
- **THEN** the reply streams in incrementally and appends to the client-side history

#### Scenario: The login gate precedes chat

- **WHEN** an unauthenticated visitor opens the chat view
- **THEN** the login prompt renders and no turn can be sent

#### Scenario: Remaining allowance is visible

- **WHEN** the chat view loads for a chatable agent
- **THEN** today's remaining subsidy and the agent's host-pool remaining render in minutes

#### Scenario: Exhaustion offers the own-key bridge

- **WHEN** a turn is refused with the allowance-exhausted error
- **THEN** the view renders the exhaustion state with an own-key input, and a pasted key switches subsequent turns to the API lane

#### Scenario: History stays client-side

- **WHEN** a visitor returns to the chat view on the same browser
- **THEN** prior history renders from client-side storage; the server holds no conversation content

### Requirement: The catalog links chatable agents to the chat view

The catalog page SHALL link an agent card to its chat view (a chat entry point) exactly when the card carries the chatability marker; non-chatable cards SHALL NOT render a chat entry.

#### Scenario: A chatable card links to chat

- **WHEN** the catalog renders an agent carrying the chatability marker
- **THEN** the card offers the chat entry point navigating to that agent's chat view

#### Scenario: A non-chatable card offers no chat entry

- **WHEN** the catalog renders an agent without the marker
- **THEN** the card renders no chat entry point

### Requirement: The console carries invocation records and the host-allowance panel

The deployer console's agent detail SHALL carry an invocation-records panel — per-caller per-channel aggregates (turns, minutes, last activity) with visitor identities masked, plus a recent activity stream — and a host-allowance panel where the deployer (or the ops credential) views and edits that agent's allowance cap. The records panel SHALL visibly distinguish the api and chat channels and degrade explicitly when the usage view is unreachable.

#### Scenario: The deployer reads invocation records

- **WHEN** the deployer opens an agent's records panel
- **THEN** per-caller per-channel aggregates and recent activity render with visitor identities masked

#### Scenario: The deployer edits the host allowance

- **WHEN** the deployer sets a new allowance cap in the panel
- **THEN** the write succeeds and the panel reflects the new cap and its remaining minutes

#### Scenario: Records degrade visibly on backend failure

- **WHEN** the usage view is unreachable
- **THEN** the panel shows an explicit error state, never an empty list masquerading as "no callers"
