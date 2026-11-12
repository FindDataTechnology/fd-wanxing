## ADDED Requirements

### Requirement: Public catalog entries carry live instance status and provenance

Every entry of the public catalog (`GET /api/wanxing/v1/agents`) SHALL carry a `status` field and a `status_as_of` timestamp. `status` SHALL be exactly one of:

- `serving` — the deployment is not paused and its usage ledger shows at least one external turn (api or chat lane) in the last 7 days;
- `idle` — the deployment is not paused and its usage ledger shows zero external turns in the last 7 days;
- `paused` — the deployment bookkeeping row marks the agent paused;
- `unknown` — reserved for "no status could be derived when this entry was built". The enumeration face's hard-stale guard (the bookkeeping-snapshot requirement) fires first and answers the explicit source-unavailable error instead of emitting entries, so in that situation the CONSUMER's own explicit-unknown mark is what a directory face renders. The facade never presents a stale derivation as current.

The status MUST be derived only from facts the facade already holds — the deployment row's pause flag and the facade's own usage ledger. It MUST NOT be inferred from silence, MUST NOT consult a second health source, MUST NOT default to `serving`, and MUST NOT report `serving` for a deployment whose snapshot is hard-stale. `status_as_of` SHALL name the snapshot instant the derivation used, so an external consumer can tell a freshly derived status from one derived up to the hard window ago (the snapshot is served stale within that window by an existing rule).

#### Scenario: A paused deployment is reported paused

- **WHEN** the deployment bookkeeping marks an agent paused while it is still listed publicly
- **THEN** its catalog entry carries `status: "paused"`

#### Scenario: Silence is reported as idle, never as serving

- **WHEN** an agent is not paused and has served zero external turns in the last 7 days
- **THEN** its catalog entry carries `status: "idle"`, not `serving`

#### Scenario: Past the hard window the face degrades instead of inventing a status

- **WHEN** the deployment snapshot is past its hard staleness window
- **THEN** the catalog answers the explicit source-unavailable error (the pre-existing rule) rather than serving entries whose status was derived from a stale snapshot, and a directory face renders its own unknown mark

#### Scenario: The status fields are purely additive

- **WHEN** a caller requests the catalog with no query parameters
- **THEN** the response carries the new fields and is otherwise field-for-field identical to the shape before this change

### Requirement: The catalog identifies itself as the deployed-instance view

The public catalog SHALL describe itself as the view of agents currently deployed for external serving, not as a marketplace directory of all published material. Its entries SHALL NOT introduce listing semantics the supply domain owns (publication state, version history, install actions); those remain the supply catalog's. When a pack has no deployment, it MUST be absent from this catalog rather than represented as an unlisted row.

#### Scenario: A published but undeployed pack is absent

- **WHEN** a pack is published in the supply catalog and has never been deployed
- **THEN** it does not appear in the Wanxing public catalog

#### Scenario: The view names its own scope

- **WHEN** a consumer or a human reads the catalog's documented scope
- **THEN** it is stated as the deployed-instance view, and publication/install semantics are explicitly out of scope

### Requirement: The catalog's chatability marker agrees with the chat lane

The public catalog's chatability marker SHALL be computed from the same admission state the chat lane enforces. A deployment that is paused SHALL NOT be marked chatable, because the chat lane refuses that same deployment — two faces of this facade MUST NOT disagree about whether a given agent can be chatted with. The marker's pause input SHALL be the deployment's real pause state, never a constant.

#### Scenario: A paused agent is not marked chatable

- **WHEN** a public agent is paused and still listed in the catalog
- **THEN** its entry carries no chatability marker, and the chat status endpoint for the same agent reports the paused reason — the two faces agree

#### Scenario: The two faces agree for every listed agent

- **WHEN** the catalog and the per-agent chat status endpoint are read for the same public agent
- **THEN** `chatable` in the catalog and `chatAble` in the status response have the same value

## MODIFIED Requirements

### Requirement: The public catalog carries a chatability marker

The public catalog and agent card summaries SHALL carry a chatability marker derived from the chatability gate, served from the cached snapshot with the snapshot's freshness semantics; the marker SHALL NOT leak private agents or allowance amounts. The marker SHALL use the deployment's real pause state as an input to that gate — a paused deployment SHALL NOT be marked chatable, and the catalog MUST NOT substitute a constant for that input.

#### Scenario: The catalog marks chatable agents

- **WHEN** the catalog lists public agents and one of them is chatable
- **THEN** that entry carries the chatability marker and non-chatable entries do not

#### Scenario: The marker leaks nothing beyond the boolean

- **WHEN** an anonymous party reads the catalog or a card
- **THEN** the entry exposes the chatability boolean only — no allowance amounts, no subsidy state beyond it, no private agents

#### Scenario: A paused deployment is not advertised as chatable

- **WHEN** an agent is paused while remaining publicly listed
- **THEN** its catalog entry carries no chatability marker, so a directory face never sends a visitor into a chat page that will refuse the turn

### Requirement: The public catalog serves server-side facets with curation and activity signals

The public catalog (`GET /agents`) SHALL support server-side filtering BEFORE pagination: `q` (case-insensitive substring over name, description, slug, and tags), `category` (exact match), and `featured=1`. A request carrying `facets=1` SHALL receive a `facets` summary block — `{ total, featured, categories: [{ name, count }] }` — computed over the UNFILTERED public list. Every catalog entry SHALL carry the curation signal — `category` (joined by pack id from the single stored curation source every directory face reads, cached; absent join degrades to no field, never a wrong one) and `featured` — plus an activity signal `turns7d` (the facade usage ledger's external turns over the last 7 days across both lanes; zero is honest zero). The facade MUST NOT derive curation independently (no heuristics from pack name, tags, or badges), and MUST NOT apply the marketplace's admission rules: here curation is a LABEL, never a filter. An operator whitelist or a curated-only admission gate on the marketplace faces MUST NOT hide, from this catalog, an agent that is deployed and public. A request with NO filter parameters SHALL return the legacy full shape byte-for-byte, apart from the additive entry fields this spec introduces (existing callers untouched).

#### Scenario: Server-side search and category filter precede pagination

- **WHEN** a caller requests `?q=法律` or `?category=legal` with paging
- **THEN** only matching public agents are returned, the page slices the FILTERED list, and `total` counts the filtered set

#### Scenario: The facets summary counts the unfiltered list

- **WHEN** a caller requests `?facets=1&category=legal`
- **THEN** the response carries `facets.categories` with counts over every public agent (not just legal ones), so a browser can render the full chip row

#### Scenario: Curation rides the catalog degraded-honestly

- **WHEN** the packs read face is unreachable or a pack row is absent
- **THEN** the catalog still serves entries; affected entries carry no `category` (they render ungrouped), and the catalog never blocks on the curation join

#### Scenario: An uncurated deployment is still listed

- **WHEN** a public agent is deployed from a pack that carries neither a category nor the featured flag
- **THEN** the agent appears in the catalog with no `category` and `featured` absent — curation filters the marketplace faces, never this one

#### Scenario: The marketplace's operator whitelist does not narrow this catalog

- **WHEN** the marketplace faces are narrowed by an operator whitelist or by curated-only admission
- **THEN** every deployed public agent still appears in this catalog, and the whitelist changes nothing here

#### Scenario: The activity signal is the usage ledger read back

- **WHEN** an agent served 12 external turns (api + chat) in the last 7 days and none before
- **THEN** its catalog entry carries `turns7d: 12`; an agent with no external turns carries `turns7d: 0`

#### Scenario: No parameters keeps the legacy shape

- **WHEN** a caller requests the catalog with no query parameters
- **THEN** the response is the legacy full-list shape with no facets block and no behavioral change beyond the additive entry fields
