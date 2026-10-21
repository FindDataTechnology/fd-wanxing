## ADDED Requirements

### Requirement: The cluster group header exposes the unit's A2A endpoint

When a cluster header's entries carry `cluster.url`, the header SHALL render the unit's endpoint as a copyable code line labeled 「集群调用」 linking to the docs face's cluster section; when the entries carry a marker without `url`, the header SHALL state that the unit is not yet callable as a whole (no default member served) instead of showing an endpoint.

#### Scenario: A listed unit's endpoint is one copy away

- **WHEN** the catalog page renders a cluster group whose entries carry `cluster.url`
- **THEN** the header shows the endpoint as code with a copy affordance and a 集群调用 link to the docs section

#### Scenario: An uncallable team says so

- **WHEN** the group's entries carry a marker without `url`
- **THEN** the header shows the not-yet-callable note and no endpoint

### Requirement: The docs one-pager documents cluster calls

The docs face SHALL carry a 集群调用 section stating the unit route shape, the send-only transport, the `metadata.agents` member selection and `metadata.aggregation` choices with the default, the per-member billing rule including the summary turn's extra charge, and a copy-ready request sample derived from the existing sample component.

#### Scenario: The section is complete and copyable

- **WHEN** a reader opens the docs face
- **THEN** the 集群调用 section shows the route, send-only note, selection and aggregation metadata, the billing rule, and a sample request they can copy
