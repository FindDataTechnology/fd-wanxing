## ADDED Requirements

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
