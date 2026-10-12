## ADDED Requirements

### Requirement: The public catalog serves server-side facets with curation and activity signals

The public catalog (`GET /agents`) SHALL support server-side filtering BEFORE pagination: `q` (case-insensitive substring over name, description, slug, and tags), `category` (exact match), and `featured=1`. A request carrying `facets=1` SHALL receive a `facets` summary block — `{ total, featured, categories: [{ name, count }] }` — computed over the UNFILTERED public list. Every catalog entry SHALL carry the pack's curation signal — `category` (from the facet packs browse, joined by pack id, cached; absent join degrades to no field, never a wrong one) and `featured` — plus an activity signal `turns7d` (the facade usage ledger's external turns over the last 7 days across both lanes; zero is honest zero). A request with NO filter parameters SHALL return the legacy full shape byte-for-byte (existing callers untouched).

#### Scenario: Server-side search and category filter precede pagination

- **WHEN** a caller requests `?q=法律` or `?category=legal` with paging
- **THEN** only matching public agents are returned, the page slices the FILTERED list, and `total` counts the filtered set

#### Scenario: The facets summary counts the unfiltered list

- **WHEN** a caller requests `?facets=1&category=legal`
- **THEN** the response carries `facets.categories` with counts over every public agent (not just legal ones), so a browser can render the full chip row

#### Scenario: Curation rides the catalog degraded-honestly

- **WHEN** the facet browse is unreachable or a pack row is absent
- **THEN** the catalog still serves entries; affected entries carry no `category` (they render ungrouped), and the catalog never blocks on the curation join

#### Scenario: The activity signal is the usage ledger read back

- **WHEN** an agent served 12 external turns (api + chat) in the last 7 days and none before
- **THEN** its catalog entry carries `turns7d: 12`; an agent with no external turns carries `turns7d: 0`

#### Scenario: No parameters keeps the legacy shape

- **WHEN** a caller requests the catalog with no query parameters
- **THEN** the response is the legacy full-list shape with no facets block and no behavioral change

### Requirement: Console deployers may deploy a discovered pack greenfield

The facade SHALL expose a console-catalog pack list (`GET /console/catalog/packs`): public listed packs joined with their serving agents (deployability) and their in-service state (the deployments snapshot's pack ids), carrying the curation fields — for the deploy wizard's directory source. The self-service deploy SHALL accept a FOREIGN public pack when that pack has NO live deployment (greenfield): the forwarded identity carries the creators group for that call alone (the console allowlist is the operator-granted deployer credential; the facet's own gate still applies), and the deploy bills on the deployer's key. A foreign pack that IS deployed SHALL be refused with a 400 naming the in-service state — upgrades belong to the author's path; a takeover of someone's live deployment through this face is impossible by construction. The author's own packs keep the existing path including redeploy.

#### Scenario: The directory source lists deployable packs with their state

- **WHEN** a verified deployer opens the wizard's directory source
- **THEN** public listed packs with serving agents are listed with category, featured, and an in-service badge; packs without serving agents are absent or marked undeployable

#### Scenario: A greenfield foreign pack deploys on the deployer's key

- **WHEN** a verified deployer deploys a public pack that has no live deployment, providing their billing key
- **THEN** the facade forwards the deploy with the creators group attached to the identity, the deployment bills on the deployer's key, and the deployed agent appears in the catalog

#### Scenario: An in-service foreign pack refuses

- **WHEN** a verified deployer attempts to deploy a foreign pack whose agents are already deployed
- **THEN** the facade refuses with a 400 naming the in-service state and pointing upgrades to the author path, and no facet deploy is forwarded

#### Scenario: The author's redeploy path is unchanged

- **WHEN** the pack's author deploys their own in-service pack through my/packs
- **THEN** the existing semantics apply verbatim — no creators-group bridging, no greenfield restriction
