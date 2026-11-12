## MODIFIED Requirements

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
