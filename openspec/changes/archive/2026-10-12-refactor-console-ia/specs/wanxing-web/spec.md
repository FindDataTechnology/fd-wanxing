## ADDED Requirements

### Requirement: The console is organized into fleet, missions, and ops tabs

The deployer console SHALL organize its surfaces into three switchable tabs — 我的舰队 (deployments management with its config/allowlist/usage/allowance panels, the plan statement, and the deploy wizard with earnings), 我的任务 (the mission list, creation, and detail), and 运维面 (the fleet board, the per-agent timeline, and the ops plan manager) — every panel's behavior, endpoint usage, and test identifier unchanged by the reorganization. Tab data SHALL load when its tab is shown (the board's polling runs only while the ops tab is active). The console's deep-link contract SHALL keep `#/console/<slug>` opening that deployment's config panel on the fleet tab, and SHALL additionally reserve `#/console/missions` and `#/console/ops` as tab routes (deployment slugs cannot collide — they carry the packs- prefix).

#### Scenario: The three tabs carry the console's surfaces

- **WHEN** a signed-in deployer opens the console
- **THEN** the fleet tab renders the deployments table with its management panels, the statement, and the deploy wizard with earnings; the missions tab renders the mission surface; the ops tab renders the board, timeline, and plan manager — each panel behaving exactly as before the reorganization

#### Scenario: Deep links still land where they landed

- **WHEN** a visitor opens `#/console/<some-packs-slug>`, `#/console/missions`, or `#/console/ops`
- **THEN** respectively the fleet tab opens with that deployment's config panel, the missions tab renders, and the ops tab renders

#### Scenario: Polling follows the tab

- **WHEN** the ops tab is not active
- **THEN** the board's periodic polling does not run; opening the tab starts it
