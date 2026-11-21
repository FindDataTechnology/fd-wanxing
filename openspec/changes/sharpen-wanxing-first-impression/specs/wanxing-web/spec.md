# Spec Delta

## ADDED Requirements

### Requirement: The site navigation carries a collections entry

站点导航 SHALL 包含一个指向 `#/collections` 的「集合」入口，与介绍 / 目录 / 文档 / 控制台并列。
该入口 SHALL 对未登录访客同样可见——集合视图自带登录门与说明，MUST NOT 因为登录态而从导航中消失：
一个只有点开部署向导才能发现的功能等于不存在。

#### Scenario: 集合入口从导航可达

- **WHEN** 访客查看站点顶栏导航
- **THEN** 可见「集合」入口，点击后到达集合视图

#### Scenario: 集合入口不随登录态消失

- **WHEN** 一个未登录访客与一个已登录部署者分别查看顶栏
- **THEN** 两者的导航都包含集合入口；未登录时集合视图显示它自己的登录门

## MODIFIED Requirements

### Requirement: The public intro view is the default landing

The web face SHALL serve a public, credential-free intro view at the hash root `#/` as the default landing. The
landing SHALL lead with live readouts of the serving plane — the count of agents currently in service and the
7-day turn count, read from the same curated public status endpoint the footer strip uses — immediately followed
by a small set of real agent cards drawn from the same catalog data the catalog page reads **and ordered by the
catalog's activity order**, so that the first thing a visitor can click on the landing is an agent that is
actually serving rather than an arbitrary slice of the registry. Below those, the landing SHALL carry the
one-sentence positioning, the A2A call sample rendered from the same shared component the docs view uses (single
source; the two surfaces cannot drift), and a link to the official site's constellation line page
(`/zh/products/constellation`).

Activity ordering SHALL be a presentation choice, never a filter: a catalog whose agents are all `turns7d: 0`
SHALL still render cards (registry order serving as the tie-break), and SHALL NOT render an empty landing
because nothing has been called yet. When the facade does not support the ordering parameter (an older
deployment), the landing SHALL render the cards it received unchanged — an unsupported ordering MUST NOT produce
an error state or a blank section.

The live dependency SHALL be bounded: the status endpoint is the landing's only live read, and when it is
unreachable the readouts render as a plain static line with no layout break, no loading skeleton, and no error
text. When the catalog read is unreachable the landing SHALL still render — positioning, call sample, and one
sentence stating that agents cannot be listed right now — and SHALL NOT render as a blank page or as "no
agents exist".

The pricing table and the about statement SHALL NOT occupy the landing's above-the-fold story; they remain
reachable, and the caller-facing pricing口径 lives in the docs view. The catalog SHALL remain reachable at
`#/catalog` with its tab; the `#/` semantic change from catalog to intro remains deliberate (first-visit
orientation first).

#### Scenario: first visit lands on the intro

- **WHEN** a visitor opens the Wanxing domain root without a hash
- **THEN** the intro view renders as the landing with live readouts and real agent cards, CTAs into the
  catalog and docs, and no credential required

#### Scenario: live readouts and real agents lead

- **WHEN** a visitor opens the Wanxing domain root without a hash and the status endpoint is healthy
- **THEN** the landing renders the in-service agent count and 7-day turn count, then real agent cards that
  navigate into the agent detail or chat views

#### Scenario: intro stays static

- **WHEN** the curated public status endpoint or the catalog read fails or is slow
- **THEN** the landing still renders its static content — positioning, call sample, CTAs — with no loading
  skeleton and no error banner where a readout would be

#### Scenario: catalog unreachable still orients the visitor

- **WHEN** the catalog read fails while the landing renders
- **THEN** the landing shows its positioning and call sample plus one honest sentence that agents cannot be
  listed right now, never an empty page and never "no agents exist"

#### Scenario: the A2A sample has a single source

- **WHEN** the docs view and the intro view both render the call sample
- **THEN** both render from the same shared component, so the two surfaces cannot drift

#### Scenario: catalog remains one click away

- **WHEN** a visitor on the intro view clicks the catalog tab or a landing CTA
- **THEN** the catalog view renders at `#/catalog` with its existing behavior unchanged

#### Scenario: landing cards follow the activity order

- **WHEN** a visitor opens `#/` and the catalog holds both serving agents (with turns) and agents with no calls
- **THEN** the leading cards come from the activity-ordered list — serving agents before never-called ones — and every card shown is still a real catalog entry

#### Scenario: nothing called yet still renders cards

- **WHEN** every public agent reports `turns7d: 0`
- **THEN** the landing still renders its card row (registry order as tie-break) and does not fall back to an empty section

#### Scenario: unsupported ordering degrades to what was returned

- **WHEN** the facade ignores or rejects the ordering parameter
- **THEN** the landing renders whatever cards the response carried, with no error banner and no blank section

### Requirement: The public catalog page lists agents for humans

The Wanxing web face SHALL serve a public catalog page (no credential) that lists deployed agents from the
facade's catalog API with pagination and server-side search, each card carrying at most four information
elements and nothing else:

1. **One line saying what the agent does for its caller** — the agent's own description when present; when the
   description is absent the card renders no substitute filler sentence, because a repeated placeholder on every
   card carries no information and actively defeats scanning.
2. **One primary status badge** — the single cross-surface fact from the shared fact table. Further signals
   (category, cluster role, chatability) MAY render, but each SHALL be visually subordinate to the primary
   status badge and SHALL NOT repeat the same emphasis level; a card SHALL NOT render a second badge that
   contradicts the primary fact.
3. **One curation signal at most** — the entry's category, or the featured marker, never a row of equally
   weighted colored chips.
4. **One entry action** — the chat entry when the agent is chatable and not paused, the detail view otherwise.

The page SHALL present itself as the deployed-instance view of the serving plane, not as a marketplace
directory. Collapsible regions SHALL be rendered only when they have content: an entry with no declared skills
SHALL NOT render an expandable section whose only payload is its slug. The status marker SHALL render the
primary facts distinctly, including an explicit `unknown` state — a deployment whose status is unreported or
whose snapshot is stale MUST NOT be rendered as if it were online, and MUST NOT be silently omitted.

The page SHALL list agents in the catalog's **activity order** — featured first, then serving, then no-calls,
with paused last — the same order the facade serves, so the page cannot invent a second judgement of its own.
That order SHALL be decided server-side before pagination, so paging never promotes a less active agent onto an
earlier page, and the page SHALL state the ordering in one line near its filters so a reader does not have to
guess why a card leads.

#### Scenario: anonymous browse

- **WHEN** a visitor opens the catalog page
- **THEN** public agents render as cards with pagination controls, and typing in the search box filters the whole catalog

#### Scenario: cards differ from one another

- **WHEN** the catalog renders agents whose descriptions differ and whose examples/skills are empty
- **THEN** each card carries its own description and no card carries a shared filler sentence standing in for absent content

#### Scenario: no expandable region with nothing in it

- **WHEN** an agent declares no skills
- **THEN** its card renders no expandable skills region, and its slug remains reachable from the detail view

#### Scenario: one primary badge per card

- **WHEN** an agent is failing while its facade status reads serving
- **THEN** the card shows the single failing fact as its primary badge and no chatability/category chip reads at the same emphasis or contradicts it

#### Scenario: catalog API unreachable degrades visibly

- **WHEN** the facade catalog API fails or is unconfigured
- **THEN** the page shows an explicit error state, never an empty list masquerading as "no agents"

#### Scenario: status markers are distinct and honest

- **WHEN** the catalog returns entries whose primary facts are serving, idle, paused, and unknown
- **THEN** each renders its own marker, and the unknown entry carries an explicit unknown label rather than an online-looking default

#### Scenario: a stale snapshot is not shown as live

- **WHEN** every entry's `status` is `unknown` because the deployment source is hard-stale
- **THEN** the page surfaces the staleness (for example via a page-level notice carrying `status_as_of`) instead of presenting a uniformly healthy board

#### Scenario: the page states its scope

- **WHEN** a visitor reads the catalog page heading or its explanatory copy
- **THEN** it identifies the page as the deployed agents currently open for external use, distinct from the supply domain's marketplace

#### Scenario: serving agents lead the first page

- **WHEN** a visitor opens the catalog page with both serving and never-called agents in the catalog
- **THEN** the first page shows serving (and featured) agents before never-called ones

#### Scenario: paging follows the same order

- **WHEN** a visitor moves to the second page
- **THEN** that page continues the same activity order rather than reverting to registry order

#### Scenario: the ordering is stated

- **WHEN** a visitor reads the catalog page's filter area
- **THEN** one line states the list ordering (featured → serving → no calls)
