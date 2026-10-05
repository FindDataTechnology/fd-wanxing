# wanxing-web 变更（delta）

## MODIFIED Requirements

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

## ADDED Requirements

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
