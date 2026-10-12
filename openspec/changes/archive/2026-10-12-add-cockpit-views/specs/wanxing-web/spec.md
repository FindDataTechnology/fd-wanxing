## ADDED Requirements

### Requirement: The fleet tab renders deployment cards

The fleet tab SHALL render the deployments as cards — each card answering the cockpit's three questions at a glance: health (运行中/已暂停 with visibility), recent activity (近 7 天回合数), and cost watermark (30-day minutes and settled value), plus the chat allowance's remaining minutes when set — beside a chat link and the existing management actions (config / records / allowance / allowlist / pause-resume) with their panels opening below as before. An unavailable summary degrades the cards' signal columns honestly (placeholder, never fake zeros), and the compact slug detail stays reachable from the card.

#### Scenario: A card answers without a manual

- **WHEN** a deployer opens the fleet tab
- **THEN** each deployment card shows its health state, 7-day turn count, 30-day minutes and value, and allowance remainder at a glance

#### Scenario: Management stays one click away

- **WHEN** a deployer acts from a card
- **THEN** the existing config / records / allowance / allowlist panels and pause-resume operate exactly as before the cards

### Requirement: The missions view visualizes progress

The missions list SHALL carry a per-mission cost watermark bar (spent against the cap, warning tone near the ceiling), and the mission detail SHALL add an overall step-progress bar (done of total) beside the cost watermark and the window's remaining time — the goal, step statuses, and report remain as before.

#### Scenario: Progress reads at a glance

- **WHEN** a deployer opens the missions tab
- **THEN** each mission row shows its spent-versus-cap bar, and an opened detail shows the step progress and cost watermarks with the window's remaining time
