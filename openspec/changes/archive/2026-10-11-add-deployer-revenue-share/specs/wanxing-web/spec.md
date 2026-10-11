# wanxing-web delta

## ADDED Requirements

### Requirement: The deploy panel carries the earnings section

The deployer console's deployment panel SHALL carry an earnings section — settled and pending totals plus recent share rows (agent, turn revenue, share amount, status) — scoped to the verified deployer identity. The section SHALL degrade explicitly when the earnings view is unreachable, never rendering an empty list masquerading as "no earnings".

#### Scenario: The deployer reads their earnings

- **WHEN** the deployer opens the deploy panel's earnings section
- **THEN** settled and pending totals render alongside recent share rows for their deployments

#### Scenario: Earnings degrade visibly on backend failure

- **WHEN** the earnings view is unreachable
- **THEN** the section shows an explicit error state, never an empty list masquerading as "no earnings"
