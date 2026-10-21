# serving-plans Specification

## Purpose

Prepaid minute plans for the Wanxing facade's API lane: an operator-issued per-caller bundle that gates admission by remaining minutes and settles turns locally in the facade ledger (settler `plan`), alongside the legacy key-balance path for planless callers (add-serving-plans, ADR-0014 boundary settlement). Callers ask for a plan through a console request queue that only ops adjudicates — issuance never leaves the ops credential (add-plan-requests-and-move-statement).

## Requirements

### Requirement: Plan lifecycle is ops-gated per caller

A serving plan SHALL be scoped to one caller (resolved from the caller's sub2api key holder) and SHALL carry a minute cap. Plans SHALL be issued and adjusted only by the ops credential through the console surface; any other verified identity SHALL be refused. The remaining allowance SHALL be derived from the ledger (cap minus plan-settled minutes for that plan), with no separate counter; an adjusted cap SHALL govern the next admission.

#### Scenario: Ops issues and adjusts a plan

- **WHEN** the ops credential issues a plan for a caller with a minute cap and later adjusts the cap
- **THEN** both writes succeed and the new cap governs the next admission

#### Scenario: A non-ops identity cannot manage plans

- **WHEN** a verified identity that is not ops attempts to issue or adjust a plan
- **THEN** the write is refused and no plan changes

#### Scenario: Remaining minutes derive from the ledger

- **WHEN** the plan's remaining allowance is read
- **THEN** it equals the cap minus the plan-settled minutes recorded in the ledger, with no independent counter to drift

### Requirement: Plan solvency gates API-lane admission

For a caller with an active plan, the facade SHALL additionally require positive remaining plan minutes at admission; an exhausted plan SHALL be refused with a structured error naming the plan-exhausted reason, and no turn SHALL start. Key validity checks SHALL still apply unchanged. A cap adjustment or new plan SHALL restore admission on the next request without any manual unsuspend.

#### Scenario: A solvent plan is admitted

- **WHEN** a caller with an active plan and positive remaining minutes requests a turn
- **THEN** the request passes admission and proceeds to agent admission

#### Scenario: An exhausted plan refuses the next turn

- **WHEN** a caller's plan has zero remaining minutes and a new turn is requested
- **THEN** the request is refused with a structured plan-exhausted error and no turn starts

#### Scenario: A refilled plan restores admission

- **WHEN** the cap is adjusted upward after exhaustion
- **THEN** the caller's next request is admitted normally, with no manual intervention

### Requirement: Plan turns settle by minute drawdown

A completed turn by a plan-backed caller SHALL settle by deducting the minute-rounded duration from the plan, recorded in the ledger with settler `plan` and the plan reference. The drawdown SHALL be idempotent per usage row; replays and retries SHALL not double-deduct.

#### Scenario: A completed turn draws down exactly once

- **WHEN** an admitted plan-backed turn completes
- **THEN** the plan's settled minutes increase once by the minute-rounded duration and the ledger records settler `plan` with the plan reference

#### Scenario: Retries do not double-draw

- **WHEN** settlement is retried or replayed for an already-settled usage row
- **THEN** the plan's settled minutes are unchanged

### Requirement: Planless callers keep the legacy balance path

A caller without an active plan SHALL settle through the pre-existing key balance deduction, unchanged; electing a plan SHALL be observable only on that caller's own settlement.

#### Scenario: A planless caller settles via key balance as before

- **WHEN** a caller with no active plan completes a turn
- **THEN** settlement follows the legacy boundary balance deduction and the ledger records it as before

### Requirement: Caller statements expose plan consumption

The console SHALL expose, per caller, a statement aggregating plan-settled minutes, remaining plan minutes, and legacy-settled minutes, with key references masked. A caller SHALL see only their own statement.

#### Scenario: A caller reads their own statement

- **WHEN** a caller opens their statement view
- **THEN** plan and legacy consumption are both visible with masked key references

#### Scenario: One caller cannot read another's statement

- **WHEN** a caller requests another caller's statement
- **THEN** the request is refused

### Requirement: Plans are API-lane only

Plans SHALL NOT affect the chat lane: visitor admission and the subsidy→host-allowance waterfall SHALL behave identically regardless of any caller's plan state.

#### Scenario: Visitor chat is unaffected by plans

- **WHEN** a visitor chats while unrelated API-lane callers hold plans
- **THEN** chat admission and settlement follow the waterfall exactly as before

### Requirement: Plan requests are caller-initiated and ops-adjudicated

A verified console identity SHALL be able to submit a plan request for itself — a desired minute cap (integer within the platform's admitted range) plus an optional note — and SHALL be able to list its own requests with their status (`pending`, `approved`, `rejected`), each carrying the requested cap, note, and adjudication note when decided. A caller with a pending request MAY submit another (the queue is not a slot); duplicate-spam is bounded by the same identity scoping and ops visibility, not by refusal. Plan requests SHALL be adjudicated only by the ops credential: approval SHALL issue or adjust the caller's plan through the existing ops-only issuance path (the request never grants anything by itself), and rejection SHALL record a note; both SHALL stamp the deciding actor and time. A non-ops identity SHALL never see another caller's requests and SHALL never adjudicate.

#### Scenario: A caller self-serves a request and watches it

- **WHEN** a verified identity posts a plan request for 5000 minutes with a note, then lists its own requests
- **THEN** the list shows the request as `pending` with the requested cap and note, and shows no other caller's requests

#### Scenario: Approval lands as a plan, not as a request side-effect

- **WHEN** the ops credential approves a pending request
- **THEN** the caller's plan carries the requested cap (via the existing issuance path, stamped by the ops actor) and the request reads `approved` with the decision time and actor

#### Scenario: Rejection is recorded, nothing is issued

- **WHEN** the ops credential rejects a request with a note
- **THEN** the request reads `rejected` with that note and the caller's plan (if any) is unchanged

#### Scenario: A non-ops identity cannot adjudicate or peek

- **WHEN** a verified non-ops identity calls the adjudication route or the ops queue listing
- **THEN** each call is refused (403) and no request state changes
