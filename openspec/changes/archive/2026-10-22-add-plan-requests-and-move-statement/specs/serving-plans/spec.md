## ADDED Requirements

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
