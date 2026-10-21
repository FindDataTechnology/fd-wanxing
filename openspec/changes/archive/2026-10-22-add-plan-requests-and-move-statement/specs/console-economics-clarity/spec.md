## MODIFIED Requirements

### Requirement: The caller-side statement card names its perspective honestly

The stats view's serving-plan statement card SHALL be titled 「API 调用对账」 (not 「我的套餐」) and SHALL carry one explanatory line stating all three facts: the card is the viewer's caller-side view, a plan is platform-issued monthly allowance (issued by ops, not self-service), and plan-less API calls bill the caller's key balance per minute. The card SHALL live in the stats (消耗) view above the consumption calibers, and SHALL NOT render in the fleet view.

#### Scenario: A deployer reads the card without misreading it

- **WHEN** the stats view renders the statement card
- **THEN** its title says 「API 调用对账」 and one line beneath explains the caller-side perspective, the ops-issued nature of plans, and key-balance billing for plan-less calls

#### Scenario: The numbers and error paths keep their behavior

- **WHEN** the statement loads, or fails to load
- **THEN** the figures shown and the error copy behave exactly as before this change — only the card's location is new

#### Scenario: The fleet view no longer carries the card

- **WHEN** the fleet view renders
- **THEN** no serving-plan statement card appears there; the deploy wizard and earnings sections are unaffected
