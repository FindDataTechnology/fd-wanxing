## ADDED Requirements

### Requirement: Streamed chat turns relay serving asks and bind them to the visitor

The chat turn surface SHALL mark every streamed turn (`message/stream`) as ask-capable toward the serving plane, SHALL relay the upstream stream byte-verbatim including `ask` events and keepalive comment frames, and SHALL record each relayed ask — its id, the admitted visitor's subject, the agent, and the ask's deadline — for the ask's window so that only that visitor may answer it. Synchronous turns (`message/send`) SHALL NOT be marked ask-capable. The public embed configuration SHALL advertise that the lane carries asks (`features.asks`).

#### Scenario: An ask reaches the widget unchanged

- **WHEN** the upstream stream emits an `ask` event during a streamed turn
- **THEN** the same event bytes reach the caller, the stream stays open, and the facade has recorded the ask id under the calling visitor and agent

#### Scenario: Keepalive frames pass through

- **WHEN** the upstream stream emits SSE comment frames while an ask is pending
- **THEN** they reach the caller unchanged and the facade's turn accounting is unaffected

#### Scenario: Synchronous turns do not opt in

- **WHEN** a caller uses `message/send`
- **THEN** the upstream request carries no ask-capable marker and any ask the agent raises is declined upstream without the facade's involvement

#### Scenario: Embed configuration advertises asks

- **WHEN** a host fetches an agent's embed configuration
- **THEN** it includes `features.asks` set to true

### Requirement: Ask answers ride an authenticated side route bound to the asking visitor

The chat surface SHALL accept `POST /api/wanxing/v1/chat/:agentSlug/ask-answer` with `{askId, answers}` or `{askId, cancelled: true}` under the same visitor authentication, cross-slug anonymous refusal, and chat-lane rate bound as a turn. An ask id that is unknown, expired, recorded under a different visitor, or recorded under a different agent SHALL be refused with a structured not-found error and nothing is forwarded. An accepted submission SHALL be forwarded to the agent's serving route and the serving plane's receipt (`{accepted: true|false, reason?}`) SHALL be returned as-is; the route SHALL NOT meter or settle minutes — the answered turn is already metered by its stream.

#### Scenario: The asking visitor answers

- **WHEN** the visitor who holds the streamed turn posts answers for its pending ask id
- **THEN** the facade forwards them to the agent and returns `{accepted: true}`

#### Scenario: A cancel resolves the ask

- **WHEN** the asking visitor posts `{askId, cancelled: true}`
- **THEN** the facade forwards the cancel and returns the serving plane's receipt

#### Scenario: Another visitor cannot answer

- **WHEN** a different authenticated visitor posts an answer for that ask id
- **THEN** the response is a structured not-found error and nothing reaches the agent

#### Scenario: An unknown or expired ask id is refused

- **WHEN** an answer arrives for an ask id the facade never relayed, or whose deadline has passed
- **THEN** the response is a structured not-found error and nothing reaches the agent

#### Scenario: A late duplicate yields the upstream receipt

- **WHEN** a second answer arrives for an ask already resolved upstream
- **THEN** the facade returns the serving plane's `{accepted: false}` receipt unchanged

#### Scenario: Answers are not metered

- **WHEN** an answer is accepted
- **THEN** no new usage row, slot, or settlement is created for it
