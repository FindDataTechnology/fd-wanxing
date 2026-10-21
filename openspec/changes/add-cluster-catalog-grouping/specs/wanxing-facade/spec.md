## ADDED Requirements

### Requirement: Catalog entries and cards carry the cluster marker

The facade SHALL maintain a cluster index derived from the facet packs surface: for every public listed pack whose browse row reports more than one agent (`agentCount > 1`), the pack detail SHALL be fetched on the catalog signals' cadence, cached and keyed by pack id plus version (a republish refreshes it), and the pack SHALL enter the index ONLY when its manifest declares a `cluster` block — the declared `name`, `description`, `defaultAgents`, `optionalAgents` and the declared member count. A multi-agent pack without a `cluster` declaration SHALL NOT group: the author's declaration is the team signal, matching the Yizuo catalog's rule. Every public catalog entry and every agent card whose deployment belongs to an indexed pack SHALL carry an additive `cluster` marker — `{ id, name, role, members }` where `id` is the pack id, `role` is `default` when the deployment's agent id is in `defaultAgents` and `optional` otherwise, and `members` is the declared member count. Entries from packs without a declaration SHALL carry no `cluster` field, and a catalog without cluster-pack deployments SHALL answer exactly as before. A detail fetch that fails SHALL degrade to the last-known index — an unknown pack renders ungrouped — and the catalog SHALL never block on the cluster join.

#### Scenario: Members of a declared cluster carry the marker

- **WHEN** a pack declaring `cluster` (defaultAgents `a`, `b`; optionalAgents `c`) has agents `a` and `c` deployed and public
- **THEN** the catalog entries for `a` and `c` both carry `cluster: { id: <packId>, name, role, members: 3 }` with `a`'s role `default` and `c`'s role `optional`, and their agent cards carry the same marker

#### Scenario: A multi-agent pack without a declaration stays flat

- **WHEN** a two-agent pack with no `cluster` block has both agents deployed
- **THEN** neither entry carries a `cluster` field

#### Scenario: Detail failure degrades to the last-known index

- **WHEN** the pack detail fetch fails during an index refresh
- **THEN** the catalog still answers; entries of packs known from the previous index keep their marker, and packs never indexed render ungrouped

#### Scenario: A republish refreshes the index

- **WHEN** a cluster pack publishes a new version whose `cluster` block changed
- **THEN** the next refresh re-reads the detail under the new version key and the marker reflects the new declaration

### Requirement: The catalog filters by cluster and counts clusters in the facets summary

`GET /agents` SHALL accept `cluster=<packId>` as a server-side filter applied BEFORE pagination — an entry matches when its `cluster.id` equals the value — combinable with the existing `q`, `category` and `featured` filters. The `facets` summary SHALL additionally carry `clusters`: the number of distinct cluster ids over the UNFILTERED public list. A request without the `cluster` parameter SHALL behave exactly as before.

#### Scenario: Cluster filter precedes pagination

- **WHEN** a caller requests `?cluster=<packId>&page=1&page_size=1` and that cluster has two public members
- **THEN** only those two members are candidates, the page carries one of them, and `total` is 2

#### Scenario: The facets summary counts clusters over the unfiltered list

- **WHEN** a caller requests `?facets=1&category=docs` while two distinct cluster packs have public members, neither in `docs`
- **THEN** `facets.clusters` is 2 regardless of the category filter

### Requirement: Self-service pack lists carry the cluster declaration

`GET /console/my/packs` and `GET /console/catalog/packs` SHALL carry, for every pack whose manifest declares `cluster`, an additive `cluster: { name, description, defaultAgents, optionalAgents }` read from the same detail fetch that yields `deployableAgents`; packs without the declaration SHALL carry no `cluster` field. The declaration is informational for the wizard: deployability SHALL stay defined by `agents[].serving` exactly as before, so a cluster member without a serving contract is still not deployable.

#### Scenario: A cluster pack's rows carry the declaration

- **WHEN** a deployer lists my/packs or the directory source and a pack declares `cluster`
- **THEN** that pack's row carries `cluster` with the declared name, description, defaultAgents and optionalAgents alongside its unchanged `deployableAgents`

#### Scenario: Declaration does not imply deployability

- **WHEN** a cluster pack's members carry no `serving` contract
- **THEN** the row carries the `cluster` declaration while `deployableAgents` is empty and `deployable` is false
