## MODIFIED Requirements

### Requirement: Admitted turns are metered and settled at the boundary

For every admitted external turn the facade SHALL record caller, agent, idempotency key, outcome, and duration in the facade ledger, and on completion SHALL settle the caller by duration — rounded up to whole minutes at the platform-configured rate. The turn's outcome SHALL be derived from the agent's answer on BOTH transports: a JSON-RPC error object (which the A2A transport carries with HTTP 200 — a model-failed turn answers 200 + `{error:{code,…}}`, never a non-2xx), an SSE `error` event on the streaming transport, or an unreadable/unparseable response SHALL mark the turn `outcome:"error"`; error rows are recorded but waived — no minutes billed, no settlement, no deployer share. Only an HTTP-level refusal or network failure of the agent route itself (non-2xx, unreachable) is additionally surfaced to the caller as a transport error; both classes are unbillable. Settlement SHALL elect by the caller's plan state: a caller with an active plan settles through an idempotent plan-minute drawdown recorded with settler `plan` (see serving-plans); a planless caller settles through an idempotent key balance deduction as before. Settlement failures on the deduction path SHALL retry with backoff; repeated failure or an exhausted balance SHALL suspend the caller, whose next admission is refused until the key passes the billing gate again. A deduction-path settlement that succeeds SHALL, in the same turn, credit the deployment's deployer a revenue share per the deployer-earnings capability when the turn is externally settled real money from a caller who is not the deployer.

#### Scenario: A completed turn settles exactly once

- **WHEN** an admitted turn completes
- **THEN** the caller is settled once for the minute-rounded duration at the configured rate, and the ledger records the settlement

#### Scenario: A model-failed turn carried as JSON-RPC error over HTTP 200 bills nothing

- **WHEN** an admitted message/send turn answers HTTP 200 with a JSON-RPC error object (e.g. the child's LLM upstream failed)
- **THEN** the caller receives that error response verbatim, the ledger records the turn with `outcome:"error"` and it is waived — zero minutes billed, no balance deduction, and no deployer share row is created

#### Scenario: An unreadable agent answer bills nothing

- **WHEN** an admitted turn's response body cannot be parsed as JSON-RPC
- **THEN** the ledger records `outcome:"error"` and the turn is waived

#### Scenario: Settlement failure retries then suspends

- **WHEN** the balance deduction fails transiently and keeps failing
- **THEN** the facade retries with backoff and suspends the caller after the configured threshold

#### Scenario: A suspended caller is re-admitted after the gate passes again

- **WHEN** a suspended caller's key later passes the billing gate (balance restored)
- **THEN** the caller's next request is admitted normally

#### Scenario: A plan-backed turn draws plan minutes instead of key balance

- **WHEN** a caller with an active plan completes an admitted turn
- **THEN** settlement deducts the minute-rounded duration from the plan (settler `plan`) and the caller's key balance is untouched

#### Scenario: An externally-settled turn credits the deployer's share in the same turn

- **WHEN** a planless caller who is not the deployer completes an admitted API-lane turn and the key-balance deduction succeeds
- **THEN** the deployer-earnings ledger records the share for that usage row and the deployer's sub2api balance is credited by `share:<usage_id>` in the same settlement pass

#### Scenario: The chat lane waives error turns by the same derivation

- **WHEN** an admitted chat-lane turn answers with a JSON-RPC error object, an SSE error event, or an unreadable body
- **THEN** the chat ledger records the turn as `outcome:"error"` and the channel settler is never invoked for it
