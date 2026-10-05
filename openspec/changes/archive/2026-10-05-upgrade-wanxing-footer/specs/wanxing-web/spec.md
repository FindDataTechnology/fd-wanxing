## ADDED Requirements

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