## ADDED Requirements

### Requirement: The widget renders in-flight asks as answerable cards

The embed view SHALL dispatch streamed frames by their SSE event name and SHALL render an `ask` event as an inquiry card inside the conversation: each question with its header and detail, its options as single- or multi-select per the question, an in-card free-text field for a custom answer, and a cancel affordance. While an ask is pending the turn's stream stays open, the composer is locked, and the card shows the time left until the ask's deadline; the widget SHALL cancel the ask itself shortly before the deadline if the visitor has not answered. Submitting the card SHALL post the answers (or the cancel) to the chat surface's answer route under the widget's current credential, after which the stream resumes and the turn completes as usual. A first-wins refusal from the answer route SHALL be shown and the card SHALL converge to the resolved state. Replayed history SHALL render an ask as a static resolved summary, never a live card.

#### Scenario: An ask becomes a card and the turn continues after the answer

- **WHEN** the stream carries an `ask` event mid-turn
- **THEN** the card renders with the questions and options, the composer is locked, and after the visitor submits, the stream continues and ends with the agent's reply

#### Scenario: Free-text and multi-select answers are encoded faithfully

- **WHEN** the visitor selects several options on a multi-select question and types a custom answer
- **THEN** the submitted answer carries the selected labels and the custom text for that question id

#### Scenario: The visitor cancels

- **WHEN** the visitor dismisses the card
- **THEN** a cancel is posted for the ask id and the agent's reply reflects a closed question

#### Scenario: Unanswered asks are cancelled before the deadline

- **WHEN** the deadline approaches with no answer
- **THEN** the widget posts a cancel itself and the turn completes on the agent's side

#### Scenario: A late answer converges

- **WHEN** the answer route reports the ask was already resolved
- **THEN** the card shows that and converges to its resolved state without a second submission

#### Scenario: History never shows a live card

- **WHEN** the widget reloads conversation history containing an ask
- **THEN** it renders as a resolved summary only

### Requirement: Host intents ride question ids and execute only on the host after explicit confirmation

A question whose id has the form `intent:<verb>:<arg>` SHALL be treated as a host intent. The embedding host MAY declare the verbs it executes in its init message; the widget SHALL render an intent question as a confirmation card and SHALL execute nothing itself. When the visitor selects the question's first option, the widget SHALL post the intent (`wx-copilot-intent` with the ask id, question id, verb and argument) to the trusted host origin only, await the host's result (`wx-copilot-intent-result`), and then answer the ask with the selected option label, appending the host's failure reason as the custom answer when the host refused or failed. Selecting any other option, or cancelling, SHALL answer the ask without posting any intent. When no host is present or the host did not declare the verb, the card SHALL say the action is unsupported on this page and the answer SHALL carry that outcome. Intent payloads carried in host context or in any message from a non-trusted origin SHALL never be executed.

#### Scenario: A declared intent executes on the host after the click

- **WHEN** the host declared `navigate` and the agent asks with id `intent:navigate:/console/usage`, and the visitor selects the first option
- **THEN** the widget posts the intent to the host origin, the host navigates, and the ask is answered with the selected label

#### Scenario: A host refusal is reported back to the agent

- **WHEN** the host replies that the intent is not allowed
- **THEN** the ask is answered with the selected label and the refusal reason as the custom answer, and no further page action occurs

#### Scenario: Declining never posts an intent

- **WHEN** the visitor selects a non-first option or cancels an intent card
- **THEN** no intent message is posted and the ask is answered accordingly

#### Scenario: Undeclared verbs are unsupported

- **WHEN** the agent asks with a verb the host did not declare, or the widget runs without a host
- **THEN** the card states the action is unsupported on this page and the answer carries that outcome

#### Scenario: Context cannot trigger intents

- **WHEN** host context or a message from an unexpected origin contains intent-shaped content
- **THEN** no intent is executed or posted
