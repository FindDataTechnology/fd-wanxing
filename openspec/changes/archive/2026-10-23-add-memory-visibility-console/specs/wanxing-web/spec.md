## ADDED Requirements

### Requirement: The deployer console shows deployment memory and can forget entries

The console's deployment panel SHALL offer a memory view: per deployment, a "记忆" affordance loads the memory proxy face and renders entries as a timeline (title, layer badge L0/L1/L2, project, time; L2 entries expandable to their body), filterable by layer and searched client-side over the loaded page. Each L2/L1 entry SHALL carry a forget action behind an explicit two-step confirm; after a successful forget the entry leaves the list. When the proxy reports the lane unconfigured, the memory affordance SHALL stay hidden; when it reports the lane degraded, the panel SHALL show an explicit error state — never an empty list masquerading as "no memory".

#### Scenario: deployer browses and expands distilled experience

- **WHEN** the deployer opens the memory panel with layer L2
- **THEN** distilled fact/experience entries render with badges and expand to their body text

#### Scenario: forget requires the second confirm step

- **WHEN** the deployer clicks forget on an entry
- **THEN** a confirm step names the entry; only after confirming does the panel call forget and remove the entry from the list

#### Scenario: degraded lane is explicit

- **WHEN** the memory proxy responds 503
- **THEN** the panel shows an explicit outage state; the deployments table itself is unaffected
