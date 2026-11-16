## MODIFIED Requirements

### Requirement: The public intro view is the default landing

The web face SHALL serve a public, credential-free intro view at the hash root `#/` as the default landing. The
landing SHALL lead with live readouts of the serving plane — the count of agents currently in service and the
7-day turn count, read from the same curated public status endpoint the footer strip uses — immediately followed
by a small set of real agent cards drawn from the same catalog data the catalog page reads, so that the first
thing a visitor can click on the landing is an actual agent. Below those, the landing SHALL carry the
one-sentence positioning, the A2A call sample rendered from the same shared component the docs view uses (single
source; the two surfaces cannot drift), and a link to the official site's constellation line page
(`/zh/products/constellation`).

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

### Requirement: The intro page carries pricing and an about statement

The intro surface SHALL state the billing model — per-minute/turn rates as configured in the billing plane, or an
honest statement that rates are unpublished — and an operator/about statement consistent with the footer, in a
location below the landing's live readouts and agent cards rather than ahead of them; the same caliber SHALL be
carried by the docs view so an evaluator reading either surface can determine what serving costs.

#### Scenario: A visitor evaluates cost

- **WHEN** a visitor reads the intro page or the docs page
- **THEN** they can determine what serving costs (or that rates are unpublished) without leaving the site

#### Scenario: pricing does not lead the landing

- **WHEN** a visitor lands on `#/` and reads the first viewport
- **THEN** they meet live readouts and real agent cards before any pricing table

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

### Requirement: The catalog links chatable agents to the chat view

The catalog page SHALL link an agent card to its chat view exactly when the card carries the chatability marker
and the agent is not paused; non-chatable or paused cards SHALL NOT render a chat entry and SHALL route to the
detail view instead. A chat entry that originates from a specific example prompt SHALL carry that prompt into
the chat view as a draft (never auto-sent), so the conversation the visitor starts is the conversation the card
promised.

#### Scenario: A chatable card links to chat

- **WHEN** the catalog renders a chatable, non-paused agent carrying the chatability marker
- **THEN** the card offers the chat entry point navigating to that agent's chat view

#### Scenario: A non-chatable card offers no chat entry

- **WHEN** the catalog renders an agent without the marker, or one that is paused
- **THEN** the card renders no chat entry point and routes to the detail view instead

#### Scenario: an example prompt arrives as a draft

- **WHEN** a visitor activates a card's example prompt
- **THEN** the chat view opens with that prompt pre-filled in the composer and not yet sent

### Requirement: Catalog cards open a detail view

Each catalog card SHALL open a detail view presenting, in three readable parts: what the agent is (name, version,
one-sentence positioning, tags/skills when declared), how it is doing now (the single primary status fact, the
7-day turn count, and the snapshot instant the status was taken from), and how to reach it (the chat entry, a
copy-pasteable A2A call sample carrying the agent's own route, and the one-line embed script), plus the
visibility the visitor is subject to (public, paused, or login required) stated in words rather than implied by
a disabled control. Example prompts deep-link into the chat view with the draft pre-filled; when the agent
declares no examples the detail SHALL NOT invent any, and SHALL offer the plain chat entry instead.

#### Scenario: A visitor inspects an agent

- **WHEN** a visitor clicks a catalog card
- **THEN** the detail view opens in place (no dead click), showing what the agent is, its current status with the snapshot instant, and a working chat entry for chatable agents

#### Scenario: Non-chatable agent detail

- **WHEN** a visitor opens the detail view of a non-chatable agent
- **THEN** the chat entry is replaced by an honest statement of why chat is unavailable, and the A2A and embed entry points remain available

#### Scenario: an agent with no declared examples

- **WHEN** the detail view renders an agent whose examples array is empty
- **THEN** no example prompt is fabricated and the chat entry stands alone

#### Scenario: the detail names the visibility

- **WHEN** a visitor opens the detail view of a paused or private agent
- **THEN** the reason they cannot chat is stated in words ("已暂停" / "需登录" / "未对访客开放"), not left to a grayed control

### Requirement: The chat view lets logged-in visitors converse with a chatable agent

The web face SHALL serve a chat view at `#/chat/:slug` for public agents. The login gate SHALL render in place on
the chat page — the agent's name, description, and any draft question visible around the login affordance — so an
unauthenticated visitor can see whom they are about to talk to before signing in, rather than meeting an
unexplained wall. The login flow SHALL carry the current location, including the draft query, through the identity
provider round trip and land back on the same conversation with the draft restored in the composer (not sent).

The view SHALL carry a remaining-allowance display (today's subsidy and the agent's host pool, minutes with an
approximate-turn hint), a message input with streamed replies (SSE), and conversation history held client-side
only — the server persists no conversation content. Assistant messages SHALL be rendered as formatted rich text
through the shared conversation core: paragraphs, ordered and unordered lists, inline code, fenced code blocks,
bold emphasis, headings at a scale suited to a conversation bubble, links, and horizontal rules. Everything
outside that subset SHALL be rendered as escaped plain text; raw HTML in an assistant reply MUST NOT be
interpreted. Visitor messages SHALL render as plain text exactly as typed. Code blocks SHALL be set in a
monospace face with horizontal overflow contained inside the bubble, and links SHALL open in a new context with
`rel="noopener noreferrer"`.

The chat view and the embed view SHALL share one conversation core (history persistence, context identity,
own-key bridge, text rendering, stream dispatch, ask handling) rather than each keeping a parallel
implementation, and both SHALL render assistant text through the same markdown renderer, so one agent never
appears to be two different products. The chat view SHALL carry the visitor's client-side history across the
transition from the pre-unification storage keys. When the lane answers the allowance-exhausted error, the view
SHALL render the exhaustion state with an own-key continuation input: a pasted caller key stored client-side,
after which turns ride the API lane as that key's caller. A not-chatable agent SHALL render an explicit not-open
state, never an empty chat masquerading as unavailable.

#### Scenario: A logged-in visitor chats with streaming

- **WHEN** a verified visitor sends a message to a chatable agent
- **THEN** the reply streams in incrementally and appends to the client-side history

#### Scenario: The login gate precedes chat

- **WHEN** an unauthenticated visitor opens the chat view
- **THEN** the login affordance renders in place on the chat page alongside the agent's name and description,
  no turn can be sent, and a draft query carried in the URL is visible before login

#### Scenario: login returns to the same conversation

- **WHEN** an unauthenticated visitor logs in from a chat view carrying a draft query
- **THEN** the callback returns to that agent's chat view with the draft restored in the composer and unsent

#### Scenario: assistant markdown renders as formatted text

- **WHEN** an assistant reply contains bold emphasis, lists, inline code, and a fenced code block
- **THEN** the bubble renders them as formatted elements, not as literal asterisks, dashes, and backticks, and the code block is monospace with its overflow contained

#### Scenario: an assistant reply cannot inject markup

- **WHEN** an assistant reply contains raw HTML or a `javascript:` link
- **THEN** the HTML renders as escaped text and the unsafe link does not become a clickable navigation

#### Scenario: the chat and embed surfaces render alike

- **WHEN** the same agent answers the same question in the in-site chat view and an embedded widget
- **THEN** both render the reply through the same formatter and produce the same visible structure

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

### Requirement: The fleet tab renders deployment cards

The fleet tab SHALL render the deployments as cards — each card opening with one human-readable conclusion
sentence derived from the cross-surface fact table and the health section (for example "近 7 天 33 回合，无健康
告警" / "该跑没跑 · 按声明应有 4 次" / "尚无调用" / "状态未知"), so a deployer scanning the grid learns each
deployment's situation without reading numbers. The card SHALL then answer the cockpit's three questions at a
glance — health (a single status badge per the cross-surface vocabulary, with visibility), recent activity
(近 7 天回合数), and cost watermark (30-day minutes and settled value), plus the chat allowance's remaining
minutes when set — beside a chat link. Management actions SHALL be layered: the primary actions stay on the
card and the remaining ones live behind a single "more" entry, all opening their existing panels in the
right-side drawer. An unavailable summary degrades the cards' signal columns honestly (placeholder, never fake
zeros), and an available all-zero summary speaks as one empty-state sentence rather than three zeros. The
compact slug detail stays reachable from the card.

#### Scenario: A card opens with a conclusion

- **WHEN** a deployer opens the fleet tab
- **THEN** each card's first line states its situation in words, before any figure

#### Scenario: A card answers without a manual

- **WHEN** a deployer reads a deployment card
- **THEN** it shows exactly one status badge, 7-day turn count, 30-day minutes and value, and allowance remainder at a glance

#### Scenario: Management stays one click away

- **WHEN** a deployer acts from a card
- **THEN** the existing config / records / allowance / allowlist panels and pause-resume operate exactly as before the cards, reached directly (primary) or through the card's "more" entry (secondary)

#### Scenario: A card never wears two status badges

- **WHEN** a deployment has a failing health entry
- **THEN** its card shows the single 「持续失败」 badge and no second, conflicting status chip

## ADDED Requirements

### Requirement: Assistant text is rendered through one controlled markdown formatter

The web face SHALL render assistant-authored text through one shared formatter used by every conversation surface
(in-site chat and embedded widget), supporting exactly: paragraphs, ordered and unordered lists, inline code,
fenced code blocks, bold emphasis, headings scaled for a conversation bubble, links, and horizontal rules. Text
outside that subset SHALL be emitted as escaped plain text. Raw HTML in assistant text MUST NOT be interpreted,
and links whose scheme is not `http`/`https`/`mailto` MUST NOT become clickable. Visitor-authored text SHALL NOT
be passed through the formatter.

#### Scenario: supported constructs render

- **WHEN** assistant text carries a heading, a list, bold text, inline code, and a fenced block
- **THEN** each renders as its formatted element within the bubble

#### Scenario: unsupported markup stays literal

- **WHEN** assistant text carries a table, an image tag, or raw HTML
- **THEN** it renders as escaped plain text rather than being parsed

#### Scenario: visitor text is never interpreted

- **WHEN** a visitor sends `**hello**` as a message
- **THEN** their bubble shows the literal asterisks

### Requirement: The two conversation surfaces share one rendering contract

The in-site chat view and the embedded widget SHALL obtain assistant text formatting from the shared conversation
core rather than each implementing its own, so a formatting change lands on both surfaces at once and the two
cannot drift.

#### Scenario: one change reaches both surfaces

- **WHEN** the formatter's supported subset changes
- **THEN** both the chat view and the embed widget reflect it without a second edit
