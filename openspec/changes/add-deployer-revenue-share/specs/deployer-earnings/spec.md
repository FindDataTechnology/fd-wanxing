# deployer-earnings 分成账本能力（新）

## ADDED Requirements

### Requirement: Revenue share is generated only for externally-settled real-money turns

The facade SHALL credit a deployer revenue share for a completed turn only when every condition holds: the row settled through the external key-balance deduction (no channel, no settler), the billable minutes are greater than zero, the agent slug resolves to a live deployment carrying its deployer identity, that identity resolves to a sub2api account, and the deployer is not the caller. Plan-backed, mission-dispatch, subsidy, host-allowance, and own-key turns SHALL NOT generate share, and a deployer calling their own deployment SHALL NOT generate share.

#### Scenario: An external caller's paid turn credits the deployer

- **WHEN** a caller distinct from the deployer completes an admitted API-lane turn that settles by key-balance deduction
- **THEN** a share row is recorded for that deployment's deployer and the share amount equals the turn revenue times one minus the platform commission

#### Scenario: Plan, mission, subsidy, host, and own-key turns never share

- **WHEN** a turn settles as plan drawdown, mission cap accounting, platform subsidy, host allowance, or own-key overflow
- **THEN** no share row is ever created for it

#### Scenario: A deployer's self-call earns nothing

- **WHEN** the deployer calls their own deployment through the API lane
- **THEN** the turn settles normally and no share row is created

#### Scenario: Waived and failed turns earn nothing

- **WHEN** a turn's outcome is an error or its billable minutes are zero
- **THEN** no share row is created

### Requirement: Share crediting is idempotent and crash-safe

Share crediting SHALL write the earnings row before crediting the deployer's sub2api balance with `adjustBalance add` under idempotency key `share:<usage_id>`, and SHALL mark the row settled on success or on an idempotent-duplicate refusal. A crash or transient failure between row write and credit SHALL leave the row pending for the settlement sweep to retry, without ever double-crediting. A usage row settled after the feature epoch that lacks its share twin despite meeting the eligibility conditions SHALL be backfilled by a reconciliation scan; rows settled before the epoch SHALL NOT be backfilled.

#### Scenario: A retry credits exactly once

- **WHEN** the credit call fails transiently and the sweep retries, or inline settle and the sweep race on the same turn
- **THEN** the deployer's balance gains the share exactly once and the earnings table holds exactly one row per usage id

#### Scenario: The crash window is reconciled, history is not

- **WHEN** a usage row settled after the epoch has no share twin
- **THEN** the reconciliation scan generates the missing share on a later sweep, and rows settled before the epoch remain untouched

### Requirement: Earnings are closed-loop with no negative rows

Earnings SHALL land only as balance credits the deployer can spend on the platform (closed-loop offset, no withdrawal in v1). The ledger SHALL contain no negative share rows; share is produced only alongside a successful deduction, so refunds and failed turns can never create negative earnings.

#### Scenario: Earnings offset consumption but never withdraw

- **WHEN** a deployer accrue earnings and spends on model usage
- **THEN** the credits are indistinguishable in balance from top-ups at sub2api, and no withdrawal endpoint exists on the earnings face

### Requirement: The console exposes the deployer's earnings view

The facade SHALL serve the deployer-scoped earnings view (recent rows plus settled and pending totals) under the console gate for a verified deployer identity, refusing the ops credential which carries no attributable identity.

#### Scenario: The deployer reads their earnings

- **WHEN** a verified deployer requests the earnings view
- **THEN** recent share rows with agent, revenue, share amount, and status render alongside settled and pending totals

#### Scenario: The ops credential is refused

- **WHEN** the ops token requests the earnings view
- **THEN** the response refuses it as lacking an attributable deployer identity

### Requirement: The platform commission is a configuration knob

The commission fraction SHALL come from environment configuration with the ADR default of 0.30, validated to the half-open range [0, 1); an out-of-range value SHALL fall back to the default with a warning.

#### Scenario: The commission knob drives the split

- **WHEN** the operator sets the commission environment variable to a valid fraction
- **THEN** subsequent eligible turns split revenue by one minus that fraction, and an invalid value changes nothing but logs a warning
