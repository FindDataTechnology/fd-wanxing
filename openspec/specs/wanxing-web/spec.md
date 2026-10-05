# wanxing-web Specification

## Purpose

The Wanxing web face at the Wanxing domain: a human-browsable public agent
catalog, the in-site integration one-pager, and the deployer console (fleet
visibility + management actions) behind deployer authentication.

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

The site footer, shared by all four views (intro, catalog, docs, console), SHALL render a 寻数产品线 ladder as a text figure: one row per line carrying the line's two-character mark (壹座, 识律, 柏讯, 谦面, 萬星), the ladder number written as the Chinese numeral (一, 十, 百, 千, 万 — per the naming contract 壹=1, 识=10, 柏=100, 谦=1000, 萬=10000), and the contract Chinese line name, with the constellation row marked 当前站点. Each row SHALL link to that line's official page (`https://www.finddatatech.cloud/zh/products/<line>/`). The figure SHALL be plain text with no image assets and SHALL wrap without horizontal overflow at narrow viewports.

#### Scenario: ladder present on every view

- **WHEN** a visitor opens any of the four views
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

The site footer SHALL further carry: (a) the brand block — the two-character mark 萬星, the name 萬星, and the positioning line Agent 服务的对外运行与服务平台; (b) a contact block labeled 联系 with the email `1253774197@qq.com` as a `mailto:` link and the phone `17753221425` as a `tel:` link; (c) an entries column — intro, catalog, docs, console, and the official site's constellation line page (`/zh/products/constellation/`); (d) the company mission sentence 寻数科技聚焦AI时代下的文本和数据处理的基础设施建设，致力于推动信息平权，最终促进社会公平。 as a full-width text line; and (e) a copyright line (© 2026 寻数（FindData）· 萬星 Constellation) alongside both filing statements as text links — the ICP filing `粤ICP备2026118740号-1` to `https://beian.miit.gov.cn/` and the public-security filing `粤公网安备44030002016558号` to the public-security query platform (`https://beian.mps.gov.cn/`), with no badge image. The footer SHALL stay static — no live fleet or catalog data.

#### Scenario: brand, contact, and entries present

- **WHEN** the footer renders on any view
- **THEN** it shows the brand block with the positioning line, the contact block with the mailto and tel links, and the entries column

#### Scenario: mission sentence present

- **WHEN** the footer renders
- **THEN** the mission sentence renders verbatim as a full-width line

#### Scenario: both filing statements are linked

- **WHEN** the footer renders
- **THEN** `粤ICP备2026118740号-1` links to the MIIT filing site and `粤公网安备44030002016558号` links to the public-security query platform

#### Scenario: footer stays static

- **WHEN** the catalog API or fleet data is unreachable or slow
- **THEN** the footer renders identically, with no loading state

### Requirement: The site header carries the single-character site mark

The header SHALL render the site mark as a text character block (a styled square rendered from text, no image asset): the single character 萬 beside the name 萬星 and the existing subtitle. The footer brand block and the ladder rows SHALL use the two-character mark 萬星, and no SVG or raster mark asset SHALL be added.

#### Scenario: header mark is the single character

- **WHEN** a visitor views the header on any view
- **THEN** the site mark renders as the single character 萬 beside 萬星

#### Scenario: marks carry no image asset

- **WHEN** the site renders
- **THEN** the marks are text, with no image request and no mark asset added to the bundle
