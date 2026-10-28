## ADDED Requirements

### Requirement: The chat lane injects the signed-in visitor's own memory digest

The facade chat lane SHALL read the tenant's memory digest face before a turn and append it to the prompt: a signed-in visitor (`tier=tenant`, carrying an email) SHALL be answered with the digest of their OWN owner root (`project=default`), while an anonymous visitor (`tier=anon`) SHALL receive no memory and MUST NOT cause any memory request. Injection SHALL apply to both `message/send` and `message/stream`. The query SHALL be the visitor's own message, never the conversation transcript.

#### Scenario: A signed-in visitor's turn carries their own digest

- **WHEN** a visitor with a verified tenant identity sends a chat message
- **THEN** the prompt sent upstream is the visitor's message followed by the digest block of their own root
- **AND** the memory read names the visitor's own owner namespace, not the deployment's

#### Scenario: An anonymous visitor never touches memory

- **WHEN** an anonymous visitor (ephemeral credential) sends a chat message
- **THEN** the prompt is byte-identical to the memory-off baseline
- **AND** no memory service request is issued

### Requirement: Memory is read through one switch and degrades open

The lane SHALL be controlled by a single switch (`WANXING_FACADE_MEMORY_DIGEST=0` disables it entirely) and SHALL be inert when memory credentials are absent. Any failure — mint failure, non-2xx digest response, timeout, malformed body — MUST leave the turn byte-identical to the memory-off baseline and MUST NOT fail the turn.

#### Scenario: The kill switch issues zero requests

- **WHEN** `WANXING_FACADE_MEMORY_DIGEST=0`
- **THEN** no memory request is made and the prompt is unchanged

#### Scenario: A memory failure still answers the turn

- **WHEN** the memory service is unreachable or exceeds the read deadline
- **THEN** the turn proceeds with the original text and the failure is logged once
