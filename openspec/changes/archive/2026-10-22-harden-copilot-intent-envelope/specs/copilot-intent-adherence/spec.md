## Purpose

约束 copilot pack 的宿主页面动作协议在**自然语言**下成立：用户一句话要去看某个页面，问询的 id 就必须是意图信封，而不是一个语义标签；并规定 pack 铸版前必须用离线评测证明这一点，而不是靠人工走查偶然发现。

## ADDED Requirements

### Requirement: A natural-language page request produces an intent envelope

When a visitor expresses a page-navigation wish in ordinary language, the copilot's `ask_user_question` call SHALL carry the intent envelope in the question `id`, formatted `intent:navigate:<path>`, where `<path>` is exactly one of the five console routes `/console`, `/console/credentials`, `/console/usage`, `/console/billing`, `/console/quota` (verbatim, no query string). A refresh wish SHALL carry `intent:refresh:` with an empty argument. The call SHALL contain exactly one question, and its options SHALL be exactly two: `执行` first, `跳过` second.

A question `id` that does not begin with `intent:` SHALL be treated as an ordinary question carrying no page action; the pack SHALL NOT rely on the host inferring an action from a semantic id, the question text, or an option label.

#### Scenario: Natural phrasing produces the envelope

- **WHEN** a visitor writes 带我去用量页 (no format instruction, no mention of `intent:`)
- **THEN** the ask's question id is exactly `intent:navigate:/console/usage`, the call holds one question, and its options are `执行` then `跳过`

#### Scenario: Every console route is reachable by its own phrasing

- **WHEN** the visitor asks in natural language to go to any one of the five console pages
- **THEN** the question id is `intent:navigate:` followed by that page's exact route, and no other route

#### Scenario: Asking where to look is not a page action

- **WHEN** the visitor asks where a piece of information is shown without asking to be taken there
- **THEN** the copilot answers with the route in prose and issues no intent ask

#### Scenario: A clarification question stays an ordinary question

- **WHEN** the copilot needs a disambiguation that is not a page action
- **THEN** it may ask a question whose id does not begin with `intent:`, and that ask carries no page action

### Requirement: Adherence holds on the always-on prompt alone

The intent envelope SHALL be stated in the pack's always-on persona prompt as a literal, copy-ready call shape with a concrete path, together with an explicit resolution of the conflict against the `ask_user_question` tool's own description of `id` as a stable identifier. The envelope SHALL NOT be reachable only through a skill body that the model must choose to load.

Adherence evidence SHALL be produced with only the always-on prompt and the tool schema in context. A result obtained with a skill body pre-loaded into the evaluation context SHALL NOT be accepted as evidence.

#### Scenario: Envelope survives without any skill body loaded

- **WHEN** adherence is evaluated with the always-on prompt and the tool schema only, with every skill body withheld
- **THEN** the envelope is still produced for every corpus utterance

#### Scenario: The conflict is resolved rather than merely restated

- **WHEN** the persona states the envelope while the tool schema describes `id` as a stable identifier
- **THEN** the persona explicitly states that for this protocol the `id` IS the envelope and not a semantic label

### Requirement: A pack mint or persona change is gated on the adherence eval

Before a copilot pack that proposes page actions is minted to a new version, or an existing such pack's persona changes, an offline adherence evaluation SHALL run against the serving lane's model and pass. The evaluation SHALL replay a fixed corpus of natural-language utterances covering all five routes plus one refresh, repeat each item a fixed number of times, and score every resulting question id against `^intent:(navigate|refresh):` with a valid argument. A pack version SHALL NOT be deployed on a failing result.

The evaluation SHALL compare at least: the literal example alone; the literal example plus a consequence statement; the literal example plus the conflict-resolution sentence; and all combined. The per-variant pass rates and failure samples SHALL be recorded in the change's measurements before the winning wording is chosen.

#### Scenario: Passing result permits the mint

- **WHEN** every corpus item produces a conforming question id across all repeats
- **THEN** the pack version may be minted and deployed

#### Scenario: Failing result blocks the mint

- **WHEN** any corpus item produces a question id that does not match the envelope
- **THEN** the pack version is not deployed, and the failing samples are recorded

#### Scenario: Wording is chosen from measured variants

- **WHEN** more than one candidate wording exists
- **THEN** the deployed wording is the variant with the highest measured pass rate, and the comparison is recorded rather than asserted
