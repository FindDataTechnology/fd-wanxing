# console-economics-clarity Specification

## Purpose

部署者控制台经济面的可懂性：调用对账卡的命名与释义、部署向导的规则前置与准备清单（起于 2026-10-22 用户真机反馈「看不懂怎么用」）。

## Requirements

### Requirement: The caller-side statement card names its perspective honestly

The fleet view's serving-plan statement card SHALL be titled 「API 调用对账」 (not 「我的套餐」) and SHALL carry one explanatory line stating all three facts: the card is the viewer's caller-side view, a plan is platform-issued monthly allowance (issued by ops, not self-service), and plan-less API calls bill the caller's key balance per minute.

#### Scenario: A deployer reads the card without misreading it

- **WHEN** the fleet view renders the statement card
- **THEN** its title says 「API 调用对账」 and one line beneath explains the caller-side perspective, the ops-issued nature of plans, and key-balance billing for plan-less calls

#### Scenario: The numbers and error paths keep their behavior

- **WHEN** the statement loads, or fails to load
- **THEN** the figures shown and the error copy behave exactly as before this change — only the title and the explanatory line are new

### Requirement: The deploy wizard surfaces the one-key-one-agent rule at selection time

The deploy wizard SHALL show the one-key-one-agent rule at the agent-selection step: when more than one agent is picked, an immediate notice SHALL appear at that step saying each agent needs its own billing key and multiple picks deploy in batches; the final billing step's existing warning remains as the backstop. The wizard header SHALL list the preparation item — creating at least one `sk-…` billing key at the billing panel — with a link, before any step is taken.

#### Scenario: Picking a second agent warns immediately

- **WHEN** the viewer checks a second agent at the selection step
- **THEN** a notice appears at that step stating one billing key binds one agent and multi-agent picks deploy in batches, without needing to advance to the billing step

#### Scenario: The billing step keeps its backstop warning

- **WHEN** more than one agent is picked and the viewer reaches the billing step
- **THEN** the existing one-key-one-agent warning still renders there

#### Scenario: The preparation line is visible before any step

- **WHEN** the wizard renders with no pack chosen
- **THEN** its header shows the billing-key preparation item with a link to the billing panel
