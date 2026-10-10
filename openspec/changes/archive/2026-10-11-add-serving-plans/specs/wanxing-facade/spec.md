# wanxing-facade Specification

## MODIFIED Requirements

### Requirement: Admitted turns are metered and settled at the boundary

For every admitted external turn the facade SHALL record caller, agent, idempotency key, outcome, and duration in the facade ledger, and on completion SHALL settle the caller by duration — rounded up to whole minutes at the platform-configured rate. Settlement SHALL elect by the caller's plan state: a caller with an active plan settles through an idempotent plan-minute drawdown recorded with settler `plan` (see serving-plans); a planless caller settles through an idempotent key balance deduction as before. Settlement failures on the deduction path SHALL retry with backoff; repeated failure or an exhausted balance SHALL suspend the caller, whose next admission is refused until the key passes the billing gate again.

#### Scenario: A completed turn settles exactly once

- **WHEN** an admitted turn completes
- **THEN** the caller is settled once for the minute-rounded duration at the configured rate, and the ledger records the settlement

#### Scenario: Settlement failure retries then suspends

- **WHEN** the balance deduction fails transiently and keeps failing
- **THEN** the facade retries with backoff and suspends the caller after the configured threshold

#### Scenario: A suspended caller is re-admitted after the gate passes again

- **WHEN** a suspended caller's key later passes the billing gate (balance restored)
- **THEN** the caller's next request is admitted normally

#### Scenario: A plan-backed turn draws plan minutes instead of key balance

- **WHEN** a caller with an active plan completes an admitted turn
- **THEN** settlement deducts the minute-rounded duration from the plan (settler `plan`) and the caller's key balance is untouched
