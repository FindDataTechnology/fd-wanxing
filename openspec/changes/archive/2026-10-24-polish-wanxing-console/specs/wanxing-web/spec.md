## ADDED Requirements

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
