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

### Requirement: The deploy panel carries the earnings section

The deployer console's deployment panel SHALL carry an earnings section — settled and pending totals plus recent share rows (agent, turn revenue, share amount, status) — scoped to the verified deployer identity. The section SHALL degrade explicitly when the earnings view is unreachable, never rendering an empty list masquerading as "no earnings".

#### Scenario: The deployer reads their earnings

- **WHEN** the deployer opens the deploy panel's earnings section
- **THEN** settled and pending totals render alongside recent share rows for their deployments

#### Scenario: Earnings degrade visibly on backend failure

- **WHEN** the earnings view is unreachable
- **THEN** the section shows an explicit error state, never an empty list masquerading as "no earnings"

### Requirement: The deploy panel walks a stepped deployment wizard

The deployer console's deploy panel SHALL present deployment as a stepped wizard replacing the raw four-field form: (1) choose a pack from my/packs — only deployable packs enter the wizard, undeployable ones stay visible with their reason badge; (2) check the serving agents to deploy — deployableAgents checkboxes defaulting to all, at least one required; (3) per-agent configuration — model (hinted by the declared modelWhitelist when present), turn budget in minutes, and work rhythm via presets plus a custom-JSON escape hatch, every field optional with the declared default shown as the fallback; (4) billing and notification — the sub2api billing key with its panel guidance link and the optional notify channel. Each step SHALL be independently visible and revisitable, and the wizard SHALL NOT block navigation away. The submit SHALL carry the wizard payload (selected agents, per-agent config, billing key, notify channel) to the facade's deploy endpoint and surface its structured refusal verbatim.

On success the result step SHALL show the share card (chat URL, chatability verdict, allowance guidance) plus the visibility close-out affordances brought forward from the management area: setting the host allowance (chat opening) and adding an allowlist caller (API access) — both operating on the freshly deployed slug through their existing endpoints. Failure of a close-out action SHALL be shown inline without undoing the deployment.

#### Scenario: The wizard replaces the raw form

- **WHEN** a signed-in deployer opens the deploy panel with at least one deployable pack
- **THEN** the panel renders the stepped wizard (pack choice → agent checkboxes → per-agent config → billing/notification), not the legacy four-field row form

#### Scenario: Agents are checked before anything deploys

- **WHEN** the deployer unchecks every agent and tries to proceed
- **THEN** the wizard refuses to advance naming the requirement, and no request is sent

#### Scenario: Per-agent config rides the deploy

- **WHEN** the deployer sets a model within the declared whitelist, a budget of 20 minutes, and an hourly rhythm preset for the selected agent, then submits with a billing key
- **THEN** the request body carries the agent selection and those per-agent values, and the result step shows the deployed slug

#### Scenario: A structured refusal surfaces verbatim

- **WHEN** the facade/facet refuses the deploy (bad billing key, lane rejection, bad subset)
- **THEN** the wizard shows the refusal's error text on the billing step without losing the entered configuration

#### Scenario: Visibility close-out follows a fresh deployment

- **WHEN** the result step renders for a freshly deployed slug
- **THEN** the share card shows the chat URL and chatability verdict, and the deployer can set the host allowance and add an allowlist caller right there; a failing close-out action shows its error inline while the deployment itself stays live

### Requirement: The catalog page filters server-side and groups by curation

The public catalog page SHALL filter through the catalog API's server-side parameters: the search box queries the server (`q`, debounced) instead of the loaded page, and a category chip row (全部 + one chip per category with its count, from the `facets` summary) narrows the list. Featured agents SHALL render as a distinct leading group (精选), and each card SHALL show its category badge and a `turns7d` activity badge (近 7 天回合). Unreachable-catalog and empty-filter states remain explicit — a filter that matches nothing renders "no match", never an error, and an unreachable catalog never renders as "no agents".

#### Scenario: Search hits the whole catalog, not the page

- **WHEN** a visitor types a term matching an agent on a later page
- **THEN** that agent appears without the visitor paging to it

#### Scenario: Category chips carry counts from the summary

- **WHEN** the page renders with `facets` present
- **THEN** each chip shows its category's count, and selecting it filters server-side to that category

#### Scenario: Featured leads and activity is visible

- **WHEN** a featured agent and unfeatured agents both match the current filter
- **THEN** the featured group renders ahead of the rest, and each card shows its 近 7 天回合 badge

### Requirement: The deploy wizard carries a directory source

The deploy wizard's pack step SHALL offer two sources: 我的 pack (the author's own packs, existing behavior) and 目录可部署 (the console catalog pack list) — the directory rows carrying the category badge, featured star, and an in-service badge; an in-service foreign pack cannot be selected (its takeover is refused by design) and says so. Selecting a greenfield directory pack enters the same wizard flow verbatim (agents → config → billing → result).

#### Scenario: The directory source feeds the wizard

- **WHEN** a deployer switches to 目录可部署 and picks a greenfield pack
- **THEN** the wizard proceeds with that pack's deployable agents exactly as with an own pack

#### Scenario: In-service packs are visible but not selectable

- **WHEN** the directory lists a pack whose agents are already deployed
- **THEN** the row shows the in-service badge, selection is disabled with the reason, and the author path is named for upgrades

### Requirement: The collections view manages the deployer's collections

The console's collections view (`#/collections`) SHALL list the signed-in deployer's collections with visibility and entry counts, create new ones, and open a detail editor: rename/describe/visibility, a whole-list entry editor fed by both sources (my packs and the directory listing with in-service badges), optional per-entry suggested config (model / budget minutes / rhythm preset or JSON), a share link for public collections, and a bundle-deploy dialog (billing key with panel guidance, optional notify channel) that submits once and renders the per-entry verdicts honestly — skipped-in-service reads as skipped, refusals show the facet's text. The view SHALL degrade explicitly on API failure, never rendering an empty list as "no collections".

#### Scenario: The entry editor feeds from both sources

- **WHEN** the deployer opens the entry editor
- **THEN** their own packs and the directory's deployable packs are offered with names and state badges, and picked entries render as reference rows with optional config inputs

#### Scenario: Bundle deploy reports per entry

- **WHEN** the deployer submits the bundle-deploy dialog
- **THEN** each entry renders its verdict — deployed (slug), skipped-in-service, refused (facet text), or error — and the collection itself is untouched

### Requirement: The bundle share page lets a visitor deploy a public collection

The public bundle page (`#/bundle/:id`) SHALL render a public collection's shared view — name, description, resolved entries with pack names, curation badges, and in-service state — for anonymous visitors read-only. A signed-in visitor SHALL additionally get the bundle-deploy dialog (same semantics as the collections view); an anonymous visitor's deploy affordance SHALL route through login first. A missing or private collection SHALL render an explicit not-found state, never an empty bundle.

#### Scenario: An anonymous visitor browses a shared bundle

- **WHEN** a visitor opens a public collection's share URL without signing in
- **THEN** the bundle renders read-only with a login-prompting deploy affordance

#### Scenario: A signed-in visitor one-click-deploys the bundle

- **WHEN** the signed-in visitor submits the deploy dialog on the share page
- **THEN** the deployment bills on their own key with per-entry verdicts, exactly as in the collections view

#### Scenario: Unknown bundles say so

- **WHEN** the share URL names a nonexistent or private collection
- **THEN** the page renders an explicit not-found state

### Requirement: The console is organized into fleet, missions, and ops tabs

The deployer console SHALL organize its surfaces into three switchable tabs — 我的舰队 (deployments management with its config/allowlist/usage/allowance panels, the plan statement, and the deploy wizard with earnings), 我的任务 (the mission list, creation, and detail), and 运维面 (the fleet board, the per-agent timeline, and the ops plan manager) — every panel's behavior, endpoint usage, and test identifier unchanged by the reorganization. Tab data SHALL load when its tab is shown (the board's polling runs only while the ops tab is active). The console's deep-link contract SHALL keep `#/console/<slug>` opening that deployment's config panel on the fleet tab, and SHALL additionally reserve `#/console/missions` and `#/console/ops` as tab routes (deployment slugs cannot collide — they carry the packs- prefix).

#### Scenario: The three tabs carry the console's surfaces

- **WHEN** a signed-in deployer opens the console
- **THEN** the fleet tab renders the deployments table with its management panels, the statement, and the deploy wizard with earnings; the missions tab renders the mission surface; the ops tab renders the board, timeline, and plan manager — each panel behaving exactly as before the reorganization

#### Scenario: Deep links still land where they landed

- **WHEN** a visitor opens `#/console/<some-packs-slug>`, `#/console/missions`, or `#/console/ops`
- **THEN** respectively the fleet tab opens with that deployment's config panel, the missions tab renders, and the ops tab renders

#### Scenario: Polling follows the tab

- **WHEN** the ops tab is not active
- **THEN** the board's periodic polling does not run; opening the tab starts it

### Requirement: The fleet tab renders deployment cards

The fleet tab SHALL render the deployments as cards — each card answering the cockpit's three questions at a glance: health (运行中/已暂停 with visibility), recent activity (近 7 天回合数), and cost watermark (30-day minutes and settled value), plus the chat allowance's remaining minutes when set — beside a chat link and the existing management actions (config / records / allowance / allowlist / pause-resume) with their panels opening below as before. An unavailable summary degrades the cards' signal columns honestly (placeholder, never fake zeros), and the compact slug detail stays reachable from the card.

#### Scenario: A card answers without a manual

- **WHEN** a deployer opens the fleet tab
- **THEN** each deployment card shows its health state, 7-day turn count, 30-day minutes and value, and allowance remainder at a glance

#### Scenario: Management stays one click away

- **WHEN** a deployer acts from a card
- **THEN** the existing config / records / allowance / allowlist panels and pause-resume operate exactly as before the cards

### Requirement: The missions view visualizes progress

The missions list SHALL carry a per-mission cost watermark bar (spent against the cap, warning tone near the ceiling), and the mission detail SHALL add an overall step-progress bar (done of total) beside the cost watermark and the window's remaining time — the goal, step statuses, and report remain as before.

#### Scenario: Progress reads at a glance

- **WHEN** a deployer opens the missions tab
- **THEN** each mission row shows its spent-versus-cap bar, and an opened detail shows the step progress and cost watermarks with the window's remaining time
