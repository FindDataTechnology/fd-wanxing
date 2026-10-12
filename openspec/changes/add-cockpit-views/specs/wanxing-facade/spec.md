## ADDED Requirements

### Requirement: The fleet summary aggregates usage and allowance per agent

The facade SHALL serve a fleet summary (`GET /fleet/summary`, verified identity) composed only from the facade's own store — one pass over the usage ledger keyed by agent slug (turns over the trailing 7 days across both lanes; minutes and settled-value over the trailing 30 days, waived turns excluded from value) plus every host allowance's limit and remaining minutes. The summary SHALL make no registry or external call (the deployments list's registry enrichment joins client-side) and an unreachable anything SHALL never degrade it — it is store-local by construction.

#### Scenario: One call answers the cockpit's three questions

- **WHEN** a verified deployer fetches the fleet summary
- **THEN** each slug carries turns7d, minutes30d, usd30d, and its allowance's limit/remaining (or no allowance key when unset) — enough to render health, activity, and cost watermarks without another call

#### Scenario: Zero activity reads as honest zero

- **WHEN** an agent has no usage rows in the windows
- **THEN** its summary entry reads zero turns/minutes/usd, not absent
