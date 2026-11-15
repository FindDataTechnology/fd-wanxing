# wanxing-web Specification

## Purpose

The Wanxing web face at the Wanxing domain: a human-browsable public agent
catalog, the in-site integration one-pager, and the deployer console (fleet
visibility + management actions) behind deployer authentication. It also
serves the visitor chat view for chatable agents and the deployer's
invocation-records and host-allowance console panels.

## Requirements

### Requirement: The public catalog page lists agents for humans

The Wanxing web face SHALL serve a public catalog page (no credential) that lists deployed agents from the facade's catalog API with pagination and client-side search over the loaded page, each entry showing name, description, version, tags, and the instance status. The page SHALL present itself as the deployed-instance view of the serving plane, not as a marketplace directory. The status marker SHALL render `serving`, `idle`, and `paused` distinctly, and SHALL render an explicit `unknown` state — a deployment whose status is unreported or whose snapshot is stale MUST NOT be rendered as if it were online, and MUST NOT be silently omitted.

#### Scenario: anonymous browse

- **WHEN** a visitor opens the catalog page
- **THEN** public agents render as cards with pagination controls, and typing in the search box filters the loaded page

#### Scenario: catalog API unreachable degrades visibly

- **WHEN** the facade catalog API fails or is unconfigured
- **THEN** the page shows an explicit error state, never an empty list masquerading as "no agents"

#### Scenario: status markers are distinct and honest

- **WHEN** the catalog returns entries whose statuses are serving, idle, paused, and unknown
- **THEN** each renders its own marker, and the unknown entry carries an explicit unknown label rather than an online-looking default

#### Scenario: a stale snapshot is not shown as live

- **WHEN** every entry's `status` is `unknown` because the deployment source is hard-stale
- **THEN** the page surfaces the staleness (for example via a page-level notice carrying `status_as_of`) instead of presenting a uniformly healthy board

#### Scenario: the page states its scope

- **WHEN** a visitor reads the catalog page heading or its explanatory copy
- **THEN** it identifies the page as the deployed agents currently open for external use, distinct from the supply domain's marketplace

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

The web face SHALL serve a chat view at `#/chat/:slug` for public agents: a visitor login gate (the tenant identity login, reused from the console's auth plumbing), the agent's name and description, a remaining-allowance display (today's subsidy and the agent's host pool, minutes with an approximate-turn hint), a message input with streamed replies (SSE), and conversation history held client-side only — the server persists no conversation content. The chat view and the embed view SHALL share one conversation core (history persistence, context identity, own-key bridge, text rendering, stream dispatch, ask handling) rather than each keeping a parallel implementation, and the chat view SHALL carry the visitor's client-side history across the transition from the pre-unification storage keys. When the lane answers the allowance-exhausted error, the view SHALL render the exhaustion state with an own-key continuation input: a pasted caller key stored client-side, after which turns ride the API lane as that key's caller. A not-chatable agent SHALL render an explicit not-open state, never an empty chat masquerading as unavailable.

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

#### Scenario: Existing local history survives the shared-core migration

- **WHEN** a returning visitor has history written under the pre-unification client-side keys
- **THEN** that history renders in the same view without loss, and subsequent turns persist under the unified keys

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

The deployer console SHALL organize its surfaces into the following switchable tabs — 我的舰队
(deployments management with its config/allowlist/usage/allowance panels, the plan statement, and the
deploy wizard with earnings), 我的任务 (the mission list, creation, and detail), 桌面机位 (the paired
device seats and their mailbox), 消耗 (the usage/stats views with the daily series chart), and 运维面
(the fleet board, the per-agent timeline, and the ops plan manager) — every panel's behavior, endpoint
usage, and test identifier unchanged by the reorganization. Tab data SHALL load when its tab is shown
(the board's polling runs only while the ops tab is active). The console's deep-link contract SHALL keep
`#/console/<slug>` opening that deployment's config panel on the fleet tab, and SHALL additionally
reserve `#/console/missions`, `#/console/devices`, `#/console/stats`, and `#/console/ops` as tab routes
(deployment slugs cannot collide — they carry the packs- prefix).

#### Scenario: The three tabs carry the console's surfaces

（场景名沿历史称谓保留；本条已扩为五个 tab。）

- **WHEN** a signed-in deployer opens the console
- **THEN** the fleet tab renders the deployments with their management panels, the statement, and the
  deploy wizard with earnings; the missions tab renders the mission surface; the devices tab renders the
  device seats; the stats tab renders the usage views and the daily chart; the ops tab renders the board,
  timeline, and plan manager — each panel behaving exactly as before

#### Scenario: Deep links still land where they landed

- **WHEN** a visitor opens `#/console/<some-packs-slug>`, `#/console/missions`, `#/console/devices`,
  `#/console/stats`, or `#/console/ops`
- **THEN** respectively the fleet tab opens with that deployment's config panel, and the missions /
  devices / stats / ops tabs render

#### Scenario: Polling follows the tab

- **WHEN** the ops tab is not active
- **THEN** the board's periodic polling does not run; opening the tab starts it

### Requirement: The fleet tab renders deployment cards

The fleet tab SHALL render the deployments as cards — each card answering the cockpit's three questions
at a glance: health (a single status badge per the cross-surface vocabulary, with visibility), recent
activity (近 7 天回合数), and cost watermark (30-day minutes and settled value), plus the chat allowance's
remaining minutes when set — beside a chat link and the existing management actions (config / records /
allowance / allowlist / pause-resume) with their management panels opening in the right-side drawer, the
management actions layered so the primary ones stay on the card. An unavailable summary degrades the
cards' signal columns honestly (placeholder, never fake zeros), and an available all-zero summary speaks
as one empty-state sentence rather than three zeros. The compact slug detail stays reachable from the card.

#### Scenario: A card answers without a manual

- **WHEN** a deployer opens the fleet tab
- **THEN** each deployment card shows exactly one status badge, 7-day turn count, 30-day minutes and
  value, and allowance remainder at a glance

#### Scenario: Management stays one click away

- **WHEN** a deployer acts from a card
- **THEN** the existing config / records / allowance / allowlist panels and pause-resume operate exactly
  as before the cards, reached directly or through the card's "more" entry

#### Scenario: A card never wears two status badges

- **WHEN** a deployment has a failing health entry
- **THEN** its card shows the single 「持续失败」 badge and no second, conflicting status chip

### Requirement: The missions view visualizes progress

The missions list SHALL carry a per-mission cost watermark bar (spent against the cap, warning tone near the ceiling), and the mission detail SHALL add an overall step-progress bar (done of total) beside the cost watermark and the window's remaining time — the goal, step statuses, and report remain as before.

#### Scenario: Progress reads at a glance

- **WHEN** a deployer opens the missions tab
- **THEN** each mission row shows its spent-versus-cap bar, and an opened detail shows the step progress and cost watermarks with the window's remaining time

### Requirement: 运维视图渲染统一舰队视图

The ops view SHALL render a short-term execution section from the board's `cells`/`shortterm`
segments: a summary line (cells, running, queued, worker occupancy) and one row per cell
(identity, running/queued, worker pool, recent terminal outcomes, sample age). Runner rows
SHALL display a pod-density badge when the runner's stats carry a truthy `pod` field; an
absent field displays nothing (degrade open). When the board carries no `cells` segment
(observer not yet upgraded), the section SHALL show an explicit not-upgraded note instead of
breaking.

#### Scenario: 短期执行区随 board 数据渲染

- **WHEN** the board carries `cells` with two entries and `shortterm` sums
- **THEN** the ops view shows the summary line and two cell rows with their counts

#### Scenario: observer 未升级时降级提示

- **WHEN** the board response has no `cells` key
- **THEN** the section renders the not-upgraded note and the rest of the view is unaffected

#### Scenario: pod 密度徽标

- **WHEN** a runner's stats carry `pod: true`
- **THEN** its row shows the density badge; runners without the field show none

### Requirement: 已登录控制台的渲染异常不得退化成空白页

已登录的控制台 SHALL 在任何面板数据缺失、形状不符或渲染抛错时仍渲染出可见界面——异常 SHALL 被截获并显示为明确的错误或占位文案，MUST NOT 因单个面板的渲染异常卸载整棵视图树。登录后的控制台 SHALL 带一层错误边界：任一面板抛错时，页面其余部分（页头、页签、其他面板）继续可用，并在出错位置显示可见的错误提示。

#### Scenario: 后端响应缺少预期字段时不黑屏

- **WHEN** 已登录部署者打开 `#/console`，而某个控制台接口返回的响应缺少前端读取的深层字段（例如套餐对账缺少 `usage`、收益缺少 `totals`）
- **THEN** 控制台仍渲染出页头、页签与其他面板，缺失数据的那个面板显示占位或错误文案，页面主体不为空

#### Scenario: 面板渲染抛错被截获

- **WHEN** 任一控制台面板在渲染过程中抛出异常
- **THEN** 错误边界截获该异常，在其位置显示可见错误提示，其余面板与导航保持可用，页面不退化为空的深色/空白页

#### Scenario: 未登录态不受影响

- **WHEN** 未登录访客打开 `#/console`
- **THEN** 仍渲染登录卡（现有行为不变），且不因上述改动出现额外的错误提示

### Requirement: 消耗视图的表格必须容纳在自身卡片内且列头列身对齐

消耗视图的按 agent 表与按模型表 SHALL 完整容纳在其所属卡片边界内，且每一列的表头与表身单元格 SHALL 始终左右对齐——任何单元格的内容长度都不得改变其所在列的宽度。内容超出列宽时 SHALL 在列内截断（省略号），并在需要时提供横向滚动，而非撑宽表格。

#### Scenario: 长 agent 名不撑破卡片

- **WHEN** 打开消耗视图，某行的 agent 名或 pack 名长度超过该列宽度
- **THEN** 表格右边界不超出其卡片的右边界，该单元格内容在列内截断，表头「agent」「pack」与其下方单元格左边缘对齐

#### Scenario: 口径列不参与撑宽

- **WHEN** 表格渲染「口径」列（取值形如 `fleet/estimated`、`sub2api/billed`）
- **THEN** 该列宽度固定不随取值长度变化，长取值在列内截断，其与右侧「回合」「tokens」列的相对位置与其他行一致

#### Scenario: 窄屏下表格不溢出

- **WHEN** 视口宽度收窄至 768px 及以下时打开消耗视图
- **THEN** 表格仍在卡片内可达（横向滚动可用），且不覆盖或顶开相邻内容与页脚

#### Scenario: 三口径分列语义不变

- **WHEN** 上述截断与滚动生效
- **THEN** 每个数字块仍各自携带口径标注（fleet 估算 / sub2api 计费 / local 估算），billed 与 estimated 在视觉上仍可区分，无任何跨口径合并数字

### Requirement: The embed view carries the copilot widget for cross-site embedding

wanxing-web SHALL serve an embeddable widget view (`#/embed/:slug`) — a floating-dock conversation surface (launcher + panel) that runs inside cross-site iframes, streams turns over the chat lane with the same mechanics as the chat view, accepts theme parameters from the embedding URL, and renders a context bar. The embed view SHALL NOT render console surfaces, site header/footer, or site chrome.

#### Scenario: An iframe load renders the widget

- **WHEN** a product-line page embeds the embed view for a chatable agent
- **THEN** the widget renders, streams a conversation turn over SSE, and shows no console or site chrome

#### Scenario: Theme parameters restyle the widget without a rebuild

- **WHEN** the embedding URL carries theme parameters
- **THEN** the widget adopts them at load with no build-time variant

### Requirement: The widget starts anonymous and upgrades by login in place

The embed view SHALL begin conversations on a freshly minted ephemeral credential whenever the agent's embed configuration permits anonymous access, with no login step; it SHALL offer an in-place login upgrade whose popup result returns to the widget via a postMessage handoff into the widget's own partitioned storage, without relying on cross-partition storage events; the identity tier in use SHALL be visible while anonymous, and an anonymous refusal or exhaustion SHALL surface the login-upgrade affordance.

#### Scenario: First chat needs no account

- **WHEN** a visitor opens an embedded widget for an anonymous-enabled agent and sends a message
- **THEN** the turn runs on a freshly minted ephemeral credential with no login step

#### Scenario: Popup login handoff survives storage partitioning

- **WHEN** the visitor completes the popup login opened from inside the iframe
- **THEN** the popup posts the credential to its opener, the widget stores it in its own partitioned storage, and subsequent turns run as the tenant identity

#### Scenario: The identity tier is visible with an upgrade affordance

- **WHEN** the widget runs anonymous
- **THEN** the visible state names the anonymous tier and offers the login upgrade

#### Scenario: Anonymous exhaustion surfaces the upgrade path

- **WHEN** an anonymous turn is refused by quota or gate with the login-upgrade error
- **THEN** the widget renders that explicit state instead of a generic failure

### Requirement: Host-relayed identity tokens are requested per turn, not persisted

The embed view SHALL accept a tenant identity token relayed by the embedding host via postMessage from a declared origin, use it for chat turns without persisting it beyond the widget session, and prefer it over the anonymous tier when present and valid; relay attempts from unexpected origins SHALL be ignored.

#### Scenario: A relayed token upgrades the lane silently

- **WHEN** the host relays a valid tenant ID token from its declared origin
- **THEN** subsequent turns run as that tenant identity with no login popup

#### Scenario: A relay from a foreign origin is ignored

- **WHEN** an identity token arrives by postMessage from an origin the widget did not expect
- **THEN** it is discarded and the widget stays on its current tier

### Requirement: Host context rides the first turn visibly

The embed view SHALL accept page context pushed by the embedding host via postMessage only from the expected origin, deliver it to the agent as a clearly marked host-provided context prefix on the turn input (data, not instruction), and display exactly what was accepted in the context bar. Context from unexpected origins SHALL be ignored.

#### Scenario: Host context reaches the agent

- **WHEN** the host page pushes context before the visitor's first message
- **THEN** the turn input carries the context as a marked prefix and the context bar shows what was sent

#### Scenario: Context from a foreign origin is ignored

- **WHEN** a context postMessage arrives from an unexpected origin
- **THEN** it is discarded and no turn content changes

### Requirement: The widget renders in-flight asks as answerable cards

The embed view SHALL dispatch streamed frames by their SSE event name and SHALL render an `ask` event as an inquiry card inside the conversation: each question with its header and detail, its options as single- or multi-select per the question, an in-card free-text field for a custom answer, and a cancel affordance. While an ask is pending the turn's stream stays open, the composer is locked, and the card shows the time left until the ask's deadline; the widget SHALL cancel the ask itself shortly before the deadline if the visitor has not answered. Submitting the card SHALL post the answers (or the cancel) to the chat surface's answer route under the widget's current credential, after which the stream resumes and the turn completes as usual. A first-wins refusal from the answer route SHALL be shown and the card SHALL converge to the resolved state. Replayed history SHALL render an ask as a static resolved summary, never a live card.

#### Scenario: An ask becomes a card and the turn continues after the answer

- **WHEN** the stream carries an `ask` event mid-turn
- **THEN** the card renders with the questions and options, the composer is locked, and after the visitor submits, the stream continues and ends with the agent's reply

#### Scenario: Free-text and multi-select answers are encoded faithfully

- **WHEN** the visitor selects several options on a multi-select question and types a custom answer
- **THEN** the submitted answer carries the selected labels and the custom text for that question id

#### Scenario: The visitor cancels

- **WHEN** the visitor dismisses the card
- **THEN** a cancel is posted for the ask id and the agent's reply reflects a closed question

#### Scenario: Unanswered asks are cancelled before the deadline

- **WHEN** the deadline approaches with no answer
- **THEN** the widget posts a cancel itself and the turn completes on the agent's side

#### Scenario: A late answer converges

- **WHEN** the answer route reports the ask was already resolved
- **THEN** the card shows that and converges to its resolved state without a second submission

#### Scenario: History never shows a live card

- **WHEN** the widget reloads conversation history containing an ask
- **THEN** it renders as a resolved summary only

### Requirement: Host intents ride question ids and execute only on the host after explicit confirmation

A question whose id has the form `intent:<verb>:<arg>` SHALL be treated as a host intent. The embedding host MAY declare the verbs it executes in its init message; the widget SHALL render an intent question as a confirmation card and SHALL execute nothing itself. When the visitor selects the question's first option, the widget SHALL post the intent (`wx-copilot-intent` with the ask id, question id, verb and argument) to the trusted host origin only, await the host's result (`wx-copilot-intent-result`), and then answer the ask with the selected option label, appending the host's failure reason as the custom answer when the host refused or failed. Selecting any other option, or cancelling, SHALL answer the ask without posting any intent. When no host is present or the host did not declare the verb, the card SHALL say the action is unsupported on this page and the answer SHALL carry that outcome. Intent payloads carried in host context or in any message from a non-trusted origin SHALL never be executed.

#### Scenario: A declared intent executes on the host after the click

- **WHEN** the host declared `navigate` and the agent asks with id `intent:navigate:/console/usage`, and the visitor selects the first option
- **THEN** the widget posts the intent to the host origin, the host navigates, and the ask is answered with the selected label

#### Scenario: A host refusal is reported back to the agent

- **WHEN** the host replies that the intent is not allowed
- **THEN** the ask is answered with the selected label and the refusal reason as the custom answer, and no further page action occurs

#### Scenario: Declining never posts an intent

- **WHEN** the visitor selects a non-first option or cancels an intent card
- **THEN** no intent message is posted and the ask is answered accordingly

#### Scenario: Undeclared verbs are unsupported

- **WHEN** the agent asks with a verb the host did not declare, or the widget runs without a host
- **THEN** the card states the action is unsupported on this page and the answer carries that outcome

#### Scenario: Context cannot trigger intents

- **WHEN** host context or a message from an unexpected origin contains intent-shaped content
- **THEN** no intent is executed or posted

### Requirement: The catalog page groups cluster members under their cluster

Within each presentation group of the catalog page (featured, rest), entries carrying a `cluster` marker SHALL render grouped by `cluster.id` under a cluster header that shows the cluster name, the declared member count, and the default/optional split; default members SHALL list before optional ones, and entries without a marker SHALL keep their flat order. The header SHALL offer a filter affordance that narrows the catalog to that cluster through the `cluster=` query. Grouping is a presentation over the current page: when a cluster's members are split across a page boundary, the header SHALL state how many of the declared members are on this page (`x / N 在本页`) rather than claim completeness. A grouped entry SHALL render the same card it renders ungrouped.

#### Scenario: Members render under one header

- **WHEN** a page carries two public members of the same declared three-member cluster and three ungrouped agents
- **THEN** the two render under one header naming the cluster with `2 / 3 在本页`, default before optional, and the three ungrouped agents render flat

#### Scenario: The header narrows to the cluster

- **WHEN** the visitor activates a cluster header's filter affordance
- **THEN** the catalog re-queries with `cluster=<packId>` and lists only that cluster's members

#### Scenario: No cluster packs, no change

- **WHEN** no entry on the page carries a marker
- **THEN** the page renders exactly as before, with no cluster header

### Requirement: The deploy wizard pre-selects a cluster pack's default members

When the picked pack (own or directory source) carries a `cluster` declaration, the wizard's agent step SHALL pre-check only the deployable agents named in `defaultAgents`, label deployable optional members 「可选」, and show the cluster name and description above the agent list; the deployer MAY still check or uncheck any deployable member. A pack without a declaration SHALL keep today's behavior — every deployable agent pre-checked.

#### Scenario: Defaults pre-checked, optional labeled

- **WHEN** the deployer picks a cluster pack whose defaults `a`, `b` and optional `c` are all deployable
- **THEN** `a` and `b` are checked, `c` is unchecked and labeled 可选, and the cluster name and description render above the list

#### Scenario: Non-cluster packs are unchanged

- **WHEN** the deployer picks a pack without a declaration
- **THEN** every deployable agent is pre-checked as before

### Requirement: The cluster group header exposes the unit's A2A endpoint

When a cluster header's entries carry `cluster.url`, the header SHALL render the unit's endpoint as a copyable code line labeled 「集群调用」 linking to the docs face's cluster section; when the entries carry a marker without `url`, the header SHALL state that the unit is not yet callable as a whole (no default member served) instead of showing an endpoint.

#### Scenario: A listed unit's endpoint is one copy away

- **WHEN** the catalog page renders a cluster group whose entries carry `cluster.url`
- **THEN** the header shows the endpoint as code with a copy affordance and a 集群调用 link to the docs section

#### Scenario: An uncallable team says so

- **WHEN** the group's entries carry a marker without `url`
- **THEN** the header shows the not-yet-callable note and no endpoint

### Requirement: The docs one-pager documents cluster calls

The docs face SHALL carry a 集群调用 section stating the unit route shape, the send-only transport, the `metadata.agents` member selection and `metadata.aggregation` choices with the default, the per-member billing rule including the summary turn's extra charge, and a copy-ready request sample derived from the existing sample component.

#### Scenario: The section is complete and copyable

- **WHEN** a reader opens the docs face
- **THEN** the 集群调用 section shows the route, send-only note, selection and aggregation metadata, the billing rule, and a sample request they can copy

### Requirement: The deployer console shows deployment memory and can forget entries

The console's deployment panel SHALL offer a memory view: per deployment, a "记忆" affordance loads the memory proxy face and renders entries as a timeline (title, layer badge L0/L1/L2, project, time; L2 entries expandable to their body), filterable by layer and searched client-side over the loaded page. Each L2/L1 entry SHALL carry a forget action behind an explicit two-step confirm; after a successful forget the entry leaves the list. When the proxy reports the lane unconfigured, the memory affordance SHALL stay hidden; when it reports the lane degraded, the panel SHALL show an explicit error state — never an empty list masquerading as "no memory".

#### Scenario: deployer browses and expands distilled experience

- **WHEN** the deployer opens the memory panel with layer L2
- **THEN** distilled fact/experience entries render with badges and expand to their body text

#### Scenario: forget requires the second confirm step

- **WHEN** the deployer clicks forget on an entry
- **THEN** a confirm step names the entry; only after confirming does the panel call forget and remove the entry from the list

#### Scenario: degraded lane is explicit

- **WHEN** the memory proxy responds 503
- **THEN** the panel shows an explicit outage state; the deployments table itself is unaffected

### Requirement: The fleet tab opens management panels in a drawer

The fleet tab SHALL open each deployment management panel (服务配置/调用记录/记忆/额度/嵌入/允许清单) inside a right-side drawer that overlays the page — one panel at a time, closable by the close affordance, the Escape key, and the overlay — instead of stacking panels below the deployment cards. The pause/resume action SHALL stay on the card. Every panel's behavior, endpoint usage, error states, and `data-testid` identifiers SHALL be unchanged by the move; the deep link `#/console/<slug>` SHALL open that deployment's config panel in the drawer.

#### Scenario: a panel opens over the list, not below it

- **WHEN** the deployer clicks 配置 on a deployment card
- **THEN** the config panel renders in a right-side drawer over the deployments list, the rest of the tab remains visible behind the overlay, and no panel is appended below the cards

#### Scenario: one at a time and closable

- **WHEN** a panel is open and the deployer presses Escape or clicks the overlay
- **THEN** the drawer closes and the deployments list is fully interactive again; opening another panel replaces the current one

#### Scenario: identifiers and deep link survive the move

- **WHEN** the drawer carries any management panel, or the deployer opens `#/console/<slug>`
- **THEN** every panel element keeps its pre-existing `data-testid`, the panel calls the same endpoints with the same error states, and the deep link opens the config drawer for that deployment

### Requirement: Successful write operations confirm with a transient toast

The console SHALL confirm successful write operations (config save, embed settings save, allowance edit, pause/resume, forget) with a transient toast — bottom-right stacked, auto-dismissing after a few seconds, exposed to assistive tech via a live region (`role="status"`). Error feedback SHALL stay in place (the panel or card banner) — the toast SHALL NOT be the error surface, because errors must persist and carry their distinct semantics (403 vs unreachable vs validation).

#### Scenario: a save confirms without a page reload or inline success text

- **WHEN** the deployer saves a deployment's config successfully
- **THEN** a bottom-right toast confirms the success and dismisses itself, and the panel stays open for further edits

#### Scenario: failures are not swallowed by toasts

- **WHEN** a write operation fails (for example the panel reports 403 or the network is unreachable)
- **THEN** the existing in-place error banner carries the failure with its distinct semantics, and no success toast appears

### Requirement: The stats view renders the daily series as a chart

The stats view's daily series SHALL render as a bar chart (x-axis = day, one series per caliber source/basis, y = tokens) using echarts, replacing the hand-rolled div bars. The calibers SHALL remain separate series — never merged into one number — the chart SHALL follow dark mode, and the `stats-daily` test identifier SHALL remain on the chart container. An empty window SHALL keep the existing explicit empty state.

#### Scenario: calibers stay distinct in the chart

- **WHEN** the daily series carries fleet/estimated, sub2api/billed, and local/estimated rows
- **THEN** the chart renders one distinct series per caliber with a legend, and no cross-caliber sum is displayed

#### Scenario: empty window and dark mode

- **WHEN** the selected window has no rows, or the site is in dark mode
- **THEN** the empty state reads 窗口内无数据 with no fake chart, and the chart's text and axis colors follow the dark theme

### Requirement: Heavy console views load lazily

The SPA SHALL code-split the authenticated-heavy views (console, chat, collections, bundle) with `React.lazy` and a skeleton Suspense fallback, so the initial bundle excludes their code. The public faces (intro, catalog, docs) and the embed view SHALL stay in the initial bundle.

#### Scenario: the initial bundle excludes console code

- **WHEN** the web app is built and a visitor loads the intro page
- **THEN** the served initial chunks contain no console-view code, and the console chunk loads on first navigation to `#/console`

#### Scenario: lazy navigation shows a skeleton, not a blank flash

- **WHEN** the deployer first navigates to a lazily loaded view
- **THEN** a skeleton placeholder renders until the chunk arrives, and no full-tree unmount or error occurs

### Requirement: The console carries a visual baseline of accent, type scale, and loading skeletons

The console SHALL carry a visual baseline: a Wanxing accent color token (applied to primary actions, selected states, and links — not a full-site recolor), a type scale whose body text is at least 12px (no `text-[10px]` body usage), loading skeletons replacing the 加载中 text placeholders, visible keyboard focus states, and accessible names on interactive controls (`role="dialog"`/`aria-modal` on the drawer, `role="status"` on toasts, associated labels on inputs).

#### Scenario: accent is visible and readable

- **WHEN** the deployer opens any console tab in light and dark mode
- **THEN** primary actions, selected states, and links render in the accent token, with readable contrast in both themes

#### Scenario: no 10px body text and no text-only loading states

- **WHEN** the console renders any panel
- **THEN** no body text renders below 12px, and loading panels show skeletons instead of the bare 加载中 text

### Requirement: Catalog cards open a detail view

Each catalog card SHALL open a detail view (route or drawer) presenting the agent's description, tags/skills, example prompts, activity signal (turns7d), chatability state, and the chat entry; example prompts deep-link into the chat view with the draft pre-filled as today.

#### Scenario: A visitor inspects an agent

- **WHEN** a visitor clicks a catalog card
- **THEN** the detail view opens in place (no dead click), showing all listed fields and a working chat entry for chatable agents

#### Scenario: Non-chatable agent detail

- **WHEN** a visitor opens the detail view of a non-chatable agent
- **THEN** example prompts render read-only with an honest explanation of why chat is unavailable (mirroring today's gray rendering, now with a reason)

### Requirement: The docs face states the concrete base URL and discovery endpoints

The docs one-pager SHALL state the concrete public base URL (`https://wanxing.finddatatech.cloud`) in place of the `$BASE` placeholder, list the `.well-known/agent-card.json` discovery endpoint, and document the caller preferences API surface; every curl sample SHALL be copy-paste runnable against production.

#### Scenario: First integration command

- **WHEN** a new integrator copies the first curl from the docs page
- **THEN** it runs against production unmodified and returns a real card

### Requirement: The intro page carries pricing and an about statement

The intro view SHALL state the current billing model as a concrete price table (per-minute/turn rates as configured in the billing plane) and an about section (what Wanxing is, operator identity), consistent with the footer statements; absent a published rate the table SHALL say so honestly rather than inventing numbers.

#### Scenario: A visitor evaluates cost

- **WHEN** a visitor reads the intro page
- **THEN** they can determine what serving costs (or that rates are unpublished) without leaving the site

### Requirement: The site footer carries a live status strip

The site footer SHALL render a live status strip fed by the curated public status endpoint — catalog size, 7-day turns, settlement pending — with graceful degradation to a static line when the endpoint is unreachable.

#### Scenario: Status strip renders

- **WHEN** a visitor loads any public page with the status endpoint healthy
- **THEN** the footer shows the three aggregates; when the endpoint fails, the footer falls back to a static line without layout breakage

### Requirement: The ops tab hides ops-only panels from non-ops identities

The ops view SHALL render ops-only management panels (plan management, approval queue) only for identities holding the ops role; non-ops deployers SHALL NOT see panels that would only render a 403 error.

#### Scenario: A plain deployer opens ops

- **WHEN** a deployer without the ops role opens the ops tab
- **THEN** they see the board/timeline but no ops-management panels, and no 403 error text renders

### Requirement: Collection deletion confirms and reports errors

Deleting a collection SHALL require explicit confirmation and SHALL surface failure with an error state (retry affordance); deletion success updates the list optimistically-or-on-ack but MUST NOT silently close on failure as today.

#### Scenario: Delete fails server-side

- **WHEN** a deployer confirms deletion and the API errors
- **THEN** an error state renders with the collection still present and a retry path

### Requirement: The chat view lets visitors clear and export history

The chat view SHALL provide explicit controls to clear local history (with confirmation) and export it (download as text/JSON); clearing is local-first and SHALL state that server-side persistence is not implied.

#### Scenario: A visitor clears history

- **WHEN** a visitor confirms clear-history
- **THEN** local storage for that agent is emptied and the view resets to empty state

#### Scenario: A visitor exports history

- **WHEN** a visitor exports history
- **THEN** a file downloads containing the local transcript, including turns from the current device only

### Requirement: The embed lane ships a runnable host demo page

The docs face (or a sibling route) SHALL ship a self-contained, copy-deployable host demo page demonstrating the postMessage protocol — init, host context, ask cards, host intents with confirmation — against production; it SHALL be the executable reference for `copilot-intent-adherence` adoption.

#### Scenario: A deployer verifies embedding

- **WHEN** a deployer hosts the demo page and opens their agent's embed lane in it
- **THEN** init/context/intents flow completes against production, demonstrating each protocol step visibly

### Requirement: A loader script mounts a line's copilot in one tag

wanxing-web SHALL serve a self-hosted loader script that a product-line page mounts with a single tag naming the line (`data-line`), with no protocol code written by the host. The loader SHALL resolve that line's binding before mounting, create the widget iframe itself, run the entire host protocol on the host's behalf (handshake, page-context pushes, per-turn identity relay, intent dispatch), and expose optional declarative hooks: an identity provider, a context provider, and an intent handler map. A host that supplies none SHALL still get a working widget on whatever visitor tier the binding permits.

The loader SHALL NOT mount the widget when the resolution answers unbound, unknown, paused, or closed, and SHALL report the reason once in the console instead of injecting a dead surface. The iframe source and behavior SHALL remain obtainable directly (the existing embed view URL), so the loader is a host-side convenience, never a new admission path.

#### Scenario: One tag mounts a working copilot

- **WHEN** a page includes the loader tag for a line bound to a ready agent and supplies no hooks
- **THEN** the widget mounts and a visitor message runs a turn on the tier the binding's effective policy permits

#### Scenario: No binding means no widget

- **WHEN** the loader tag names an unbound, unknown, paused, or closed line
- **THEN** nothing is injected into the page and one console message names the reason

#### Scenario: Host hooks replace host-written protocol

- **WHEN** the page supplies an identity provider before the first turn
- **THEN** the loader relays the token per turn without the host writing any postMessage code, and the widget prefers it over the anonymous tier

#### Scenario: Declared intents are the only executable ones

- **WHEN** the page supplies an intent handler for a verb the loader declares at handshake
- **THEN** only that verb executes against the handler and every other verb is answered as unsupported

#### Scenario: The direct embed URL keeps working

- **WHEN** a page embeds the existing embed view URL directly, without the loader
- **THEN** the widget behaves exactly as before the loader existed

### Requirement: The console carries the line-copilot binding panel

The console SHALL carry an ops-only panel listing every line binding (line, bound agent, accent, intended visitor policy), the effective anonymous state resolved for it, and an explicit gap indicator when intent and effect disagree. Binding SHALL offer a deployment picker restricted to public deployments and an accent field; each row SHALL offer unbind behind a two-step confirmation. Non-ops identities SHALL NOT see the panel, consistent with the existing ops-panel visibility rule.

#### Scenario: A gap between intent and effect is visible

- **WHEN** a line is bound with anonymous intended but the agent's anonymous setting is off
- **THEN** the row names the gap and the widget's resulting behaviour for a visitor without host identity

#### Scenario: An agent pause shows through

- **WHEN** the bound deployment is paused
- **THEN** the row shows the closed state and the line's outward copilot stops mounting

#### Scenario: Unbind is confirmed and takes effect

- **WHEN** ops confirms unbinding a line
- **THEN** the row disappears and the line's resolution answers unbound

### Requirement: The chat view renders in-flight asks as answerable cards

The in-site chat view SHALL dispatch streamed frames by event name and SHALL render an `ask` event as an answerable inquiry card with the same question, option, free-text, cancel, and deadline behaviour the embed view offers, answering through the same answer route under the view's credential. Replayed history SHALL render an ask as a static resolved summary. A late or refused answer SHALL converge to the resolved state rather than leaving a live card.

#### Scenario: An in-site visitor answers an ask

- **WHEN** a streamed turn on `#/chat/:slug` carries an `ask` event
- **THEN** the card renders, the composer locks, and the submitted answer continues the turn

#### Scenario: Chat and embed describe one ask the same way

- **WHEN** the same ask is rendered in the chat view and the embed view
- **THEN** both show the same questions, options, deadline behaviour, and resolved summary wording

### Requirement: The login upgrade names the platform it signs the visitor into

When a widget cannot serve a visitor on an anonymous tier and no host identity is available, the login affordance SHALL name the platform the visitor is about to sign into, so a visitor arriving from a product-line page is never implicitly asked to create an account on a product they did not open. When a host identity provider is available, that path SHALL be offered first.

#### Scenario: The upgrade names the destination

- **WHEN** an anonymous visitor hits the upgrade affordance from a third-party page
- **THEN** the affordance and its copy identify the sign-in platform by name

#### Scenario: Host identity is preferred over the popup

- **WHEN** the embedding page supplies an identity provider and the visitor is signed in there
- **THEN** turns run on the relayed identity and the popup upgrade is not offered as the primary path

### Requirement: The fleet view surfaces unhealthy agents first

The deployer console's fleet view SHALL render a health marker per deployment
derived from the observer's agent health, and SHALL order unhealthy deployments
above healthy ones within the view's existing grouping. A deployment reported as
`failing` SHALL state how long it has been failing and the failure cause when
known; a deployment reported as `silent` SHALL be marked as having no traffic
rather than as healthy or failing. Paused deployments SHALL be marked as paused.

#### Scenario: A failing deployment sorts to the front and explains itself

- **WHEN** the deployer opens the fleet view and one of their deployments is failing
- **THEN** that deployment appears above healthy ones, shows the failing duration, and names the failure cause when it is known

#### Scenario: A silent deployment is not presented as healthy

- **WHEN** a deployment has had no turns in the window
- **THEN** it is marked as no-traffic rather than carrying a healthy marker

#### Scenario: Health data unavailable degrades honestly

- **WHEN** the observer's health section is missing or unreachable
- **THEN** the fleet view renders without health markers and does not imply the deployments are healthy

### Requirement: The ops view lists every unhealthy agent with its duration

The ops view SHALL list all agents currently failing or degraded across the fleet
with their failing duration and failure cause, and SHALL offer a pointer to the
per-agent view where the cause can be inspected.

#### Scenario: Ops sees the whole unhealthy set at once

- **WHEN** ops opens the ops view
- **THEN** every currently failing or degraded agent is listed with its duration and cause

#### Scenario: The empty state is explicit

- **WHEN** no agent is failing or degraded
- **THEN** the view states that explicitly instead of rendering an empty list

### Requirement: No traffic and should-have-run are distinct on every health surface

Wherever a deployment's health is shown, a `silent` deployment whose declared rhythm implies turns
SHALL read as "should have run and did not", naming the implied count, and SHALL NOT read as "no
traffic". A `silent` deployment with no rhythm declaration SHALL keep reading as "no traffic" with
the same wording as before this requirement. Stalled deployments SHALL sort above plain silent ones
within the view's ordering.

#### Scenario: A stalled deployment says it should have run

- **WHEN** a deployment reports silent with an implied turn count reaching the minimum
- **THEN** its marker names that it should have run, with the implied count, instead of "no traffic"

#### Scenario: A non-rhythmic deployment keeps its wording

- **WHEN** a deployment reports silent with no implied count
- **THEN** its marker reads "no traffic" exactly as it did before this requirement

#### Scenario: Stalled sorts above merely silent

- **WHEN** a view lists both a stalled deployment and a merely silent one
- **THEN** the stalled one appears first

#### Scenario: An older observer's entries still render

- **WHEN** the health section omits the implied count and staleness fields entirely
- **THEN** every deployment renders with the pre-existing wording and no crash

### Requirement: One status fact, one badge, across every surface

萬星的每一个展示面（公开目录、agent 详情、部署者舰队卡、运维面机群板）SHALL 用同一张事实表与同一条
优先级链把 agent 的当前状态说成**一枚**人读主徽标，而不是各自发明词汇。

事实表 SHALL 覆盖且仅覆盖以下七种事实，优先级由高到低：

| 优先级 | 事实 | 依据 |
|---|---|---|
| 1 | 已暂停 | 管理员暂停（`status=paused` 或 `health=paused`） |
| 2 | 状态未知 | 快照过期/未上报（`status=unknown`，或观测面无该 agent 的 health 条目） |
| 3 | 持续失败 | `health=failing` |
| 4 | 部分失败 | `health=degraded` |
| 5 | 该跑没跑 | `health=silent` 且 `health.stalled=true` |
| 6 | 尚无调用 | `status=idle` 或 `health=silent` 且未 stalled |
| 7 | 在役 | `status=serving` 且 `health=ok`（或无 health 条目但状态新鲜） |

主徽标的判定 SHALL 按优先级取第一个命中项——**同一次渲染里同一 agent 的状态位置只 SHALL 出现一枚
主徽标**，不得并列出现两枚语义冲突的状态徽标（例如「运行中」与「持续失败」并排）。

展示措辞 SHALL NOT 把「近 7 天有无调用」说成「进程运行中/空闲待命」——`serving` 的展示不得读作
「服务在运行」，`idle` 的展示不得读作「空闲待命」。

门面 `/api/wanxing/v1/agents` 的字段形状与取值（`status` 四值、`status_as_of`）SHALL NOT 因本条改变：
本要求约束**消费侧怎么读**，不约束生产侧怎么发。

#### Scenario: A failing agent shows one badge, not two

- **WHEN** 某 agent 的观测面 health 为 `failing`，门面 status 为 `serving`
- **THEN** 该 agent 在目录、详情、舰队卡上各自只出现一枚「持续失败」主徽标，不再出现与之并列的
  「运行中」或「在役」徽标

#### Scenario: Stalled differs from unused

- **WHEN** 某 agent 窗口内零回合，且其观测面 health 为 `silent` 并携带 `stalled=true`
- **THEN** 它的主徽标是「该跑没跑」（同时说明按声明应有几次），而不是「尚无调用」，也不是任何读起来健康的措辞

#### Scenario: Unreported status never reads as healthy

- **WHEN** 某 agent 门面 status 为 `unknown`，或观测面无该 agent 的 health 条目
- **THEN** 它的主徽标是「状态未知」，既不读作「在役」，也不读作「尚无调用」

#### Scenario: Served-but-idle is worded as traffic, not process

- **WHEN** 某 agent 门面 status 为 `idle`（近 7 天零调用）
- **THEN** 其徽标措辞表达「近 7 天无调用/尚无调用」之意，而不出现「空闲」这类会被读作「进程待命」的词

### Requirement: Absent signals never render as zeros

当某个数据面尚未返回（请求未落地、观测面无该段、summary 为 null）时，信号位 SHALL 渲染占位，
**SHALL NOT 渲染 0 或 $0.00**；当数据面已经返回且值确为零时，该组信号 SHALL 以一个明确的空态措辞
（例如「尚无调用记录」）替代成排的 0 与 $0.00。

#### Scenario: Summary not loaded yet

- **WHEN** 舰队卡的用量 summary 尚未返回
- **THEN** 近 7 天回合 / 近 30 天分钟 / 近 30 天结算三格显示占位，不显示 0、不显示 $0.00

#### Scenario: Real zeros speak as one sentence

- **WHEN** 用量 summary 已返回且三项全为 0
- **THEN** 三格收成一句「尚无调用记录」，而不是 `0 / 0 / $0.00`

### Requirement: The ops board is readable and states its scope

运维面机群板的顶行状态枚举 SHALL 以中文呈现，原始枚举值 SHALL 保留在可悬停的 `title` 或等价的
可达说明里（排障可读，访客不撞）。

该枚举行的状态 SHALL 明确区分于上文「跨面状态事实」——它统计的是 runner 生命周期的分布
（在役/常驻/已暂停/启动中/退出中/预热/未知），**不得**改写成 agent 状态主徽标的词汇，否则会把
「这一轮谁在跑」和「这个 agent 健不健康」混为一谈。

板 SHALL 带一行口径说明：板统计的是**窗口内被观测到的** agent，与公开目录的「在役 agent 数」不是
同一口径；两个数字不相等本身不是故障。

当板缺少某段数据（无 `runner_stats`、无任务、observer 未升级到携带 `cells`）时，空态 SHALL 说明
「为什么空」与「去哪看」，而不是只留一句「窗口内无 X」。

#### Scenario: Enum row reads in Chinese and stays a distinct vocabulary

- **WHEN** 部署者打开运维面，板回传 runner 生命周期 states 枚举
- **THEN** 顶行每个状态都以中文呈现且悬停可读到原始枚举值，且这些措辞与 agent 状态主徽标
  （在役/尚无调用/持续失败…）不混用

#### Scenario: Two counts explain themselves

- **WHEN** 板的 agents 数与页脚状态条的「N 个 agent 在役」不相等
- **THEN** 板上有一行口径说明指出两者的统计范围不同，读者不会将其理解为数据错误

#### Scenario: Absent runner stats says where to look

- **WHEN** 窗口内无 `runner_stats`
- **THEN** 该区块给出「为什么空/去哪看」的说明，而不是仅一句「窗口内无 runner_stats」

### Requirement: Fleet card actions are layered, behavior unchanged

舰队卡的管理操作 SHALL 分层呈现：主操作留在卡面，其余收进卡内「更多」入口。**每一个管理面板的
行为、端点与测试标识 SHALL 保持不变**，暂停/恢复与对话入口 SHALL 始终在卡面可达。

#### Scenario: Primary actions stay on the card

- **WHEN** 部署者查看一张舰队卡
- **THEN** 暂停/恢复与对话入口在卡面直接可达，其余管理入口经一次展开后可达且行为与分层前一致

#### Scenario: Every panel still opens

- **WHEN** 部署者从分层后的入口打开配置/记录/记忆/额度/嵌入/允许清单任一面板
- **THEN** 该面板的行为、端点调用与测试标识与分层前完全相同

### Requirement: Visitor-facing labels are human-readable without hiding unknowns

公开目录与 agent 详情的标签 SHALL 经一张人读字典渲染已知的内部枚举（线标记与内部状态类标签，
例如 `wire`、`lex`、`facet`、`yizuo`、`security-pending`、`M2`）。字典未命中的标签 SHALL 原样呈现，
**SHALL NOT 被吞掉或替换为占位**。

当 agent 未声明示例问句时，卡片与详情页 SHALL 呈现一个不残缺的形态（给出下一步：直接对话／看对接
文档），SHALL NOT 留下空段落或「（未声明）」式的残缺表达。

#### Scenario: Known internal label renders human-readable

- **WHEN** 目录卡携带标签 `security-pending` 与 `wire`
- **THEN** 两者都以访客可读的中文呈现，原始值保留在可达说明里

#### Scenario: Unknown label passes through untouched

- **WHEN** 目录卡携带一个字典未命中的标签
- **THEN** 该标签原样显示，不被丢弃也不被替换

#### Scenario: No examples is not a hole

- **WHEN** 一个可对话 agent 未声明 examples
- **THEN** 卡片与详情页不出现空的示例段落或「（未声明）」，而是给出直接对话入口与文档指引
