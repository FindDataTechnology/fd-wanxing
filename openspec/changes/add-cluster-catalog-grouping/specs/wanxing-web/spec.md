## ADDED Requirements

### Requirement: The catalog page groups cluster members under their cluster

Within each presentation group of the catalog page (featured, rest), entries carrying a `cluster` marker SHALL render grouped by `cluster.id` under a cluster header that shows the cluster name, the declared member count, and the default/optional split; default members SHALL list before optional ones, and entries without a marker SHALL keep their flat order. The header SHALL offer a filter affordance that narrows the catalog to that cluster through the `cluster=` query. Grouping is a presentation over the current page: when a cluster's members are split across a page boundary, the header SHALL state how many of the declared members are on this page (`x / N 在本页`) rather than claim completeness. A grouped entry SHALL render the same card it renders ungrouped.

#### Scenario: Members render under one header

- **WHEN** a page carries two public members of the same declared three-member cluster and three ungrouped agents
- **THEN** the two render under one header naming the cluster with `2 / 3 在本页`, default before optional, and the three ungrouped agents render flat

#### Scenario: The header narrows to the cluster

- **WHEN** the visitor activates a cluster header's filter affordance
- **THEN** the catalog re-queries with `cluster=<packId>` and lists only that cluster's members

#### Scenario: No cluster packs, no change

- **WHEN** no entry on the page carries a marker
- **THEN** the page renders exactly as before, with no cluster header

### Requirement: The deploy wizard pre-selects a cluster pack's default members

When the picked pack (own or directory source) carries a `cluster` declaration, the wizard's agent step SHALL pre-check only the deployable agents named in `defaultAgents`, label deployable optional members 「可选」, and show the cluster name and description above the agent list; the deployer MAY still check or uncheck any deployable member. A pack without a declaration SHALL keep today's behavior — every deployable agent pre-checked.

#### Scenario: Defaults pre-checked, optional labeled

- **WHEN** the deployer picks a cluster pack whose defaults `a`, `b` and optional `c` are all deployable
- **THEN** `a` and `b` are checked, `c` is unchecked and labeled 可选, and the cluster name and description render above the list

#### Scenario: Non-cluster packs are unchanged

- **WHEN** the deployer picks a pack without a declaration
- **THEN** every deployable agent is pre-checked as before
