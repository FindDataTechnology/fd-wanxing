# fleet-ownership-gates Specification

## Purpose

舰队面（「我的舰队」）的归属语义：哪个登录身份能看见哪些部署卡、谁能对谁的部署执行管理动作（暂停/恢复、允许清单、记录、额度、嵌入、配置），以及一个被拒或失败的管理动作在 web 控制台必须可见反馈。起于 2026-10-22 生产真机实证的三层缺陷：列表不按身份过滤、403 被前端吞成静默死按钮、暂停/允许清单反向无归属校验。

## Requirements

### Requirement: The fleet list is scoped to the viewer's own deployments

`GET /api/wanxing/v1/console/deployments` SHALL return, for a verified console identity, only the deployments whose bookkeeping `deployedBy` matches that identity's email (case-insensitive). The ops service credential SHALL continue to receive every deployment, including rows that carry no `deployedBy`. When the viewer's filtered list is empty, the web console SHALL show an explicit empty state pointing to the deploy wizard instead of a blank section.

#### Scenario: A deployer sees only their own cards

- **WHEN** the signed-in identity deployed agents A and B while other identities deployed C through F
- **THEN** the listing returns exactly A and B, with no field of C–F's rows exposed

#### Scenario: The ops credential still sees everything

- **WHEN** the request rides the ops service token
- **THEN** every deployment is listed, including rows with no `deployedBy` recorded

#### Scenario: An empty fleet has a visible empty state

- **WHEN** the signed-in identity has deployed nothing
- **THEN** the fleet section shows an explicit empty state that links toward the deploy wizard rather than rendering nothing

### Requirement: Every management action is deployer-or-ops

Pause, resume, and allowlist read/add/remove SHALL enforce the same deployer-or-ops gate the records, host-allowance and embed-settings faces already enforce: a verified identity that is not the deployment's deployer SHALL receive 403 for read and write alike, with no observable state change; the ops credential SHALL act on any deployment. The deployer themself SHALL keep full ability on their own deployments.

#### Scenario: A non-deployer cannot pause or resume

- **WHEN** a verified identity that did not deploy the agent calls pause or resume on it
- **THEN** the call answers 403 and the deployment's paused state is unchanged

#### Scenario: A non-deployer cannot read or mutate the allowlist

- **WHEN** the same identity calls the allowlist read, add or remove on that agent
- **THEN** each call answers 403 and the allowlist is unchanged

#### Scenario: The deployer round-trips their own deployment

- **WHEN** the deployer pauses and then resumes their own agent
- **THEN** both calls succeed and the state takes effect within the established polling window

#### Scenario: The ops credential is unaffected

- **WHEN** the ops credential pauses, resumes or edits any allowlist
- **THEN** the call succeeds exactly as before this change

### Requirement: A refused or failed management action is visible in the web console

When a management-panel load (config, records, allowance, embed settings, allowlist) fails with a non-2xx response or a network error, the web console SHALL render the error feedback in the fleet section in view — never solely inside a panel that failed to open — and SHALL distinguish refusal from transient failure by status: 403 renders ownership wording stating the viewer is not this deployment's deployer (no "try again later" phrasing), while 5xx and network failures render retry wording.

#### Scenario: A 403 surfaces with ownership wording at the card

- **WHEN** a management button's load answers 403
- **THEN** feedback appears next to the fleet cards naming the ownership reason, without transient-failure phrasing, and no panel opens

#### Scenario: A backend outage surfaces with retry wording

- **WHEN** the packs surface is down and a config load answers 5xx
- **THEN** feedback appears in the same place with retry wording naming the failing face

#### Scenario: A successful load still opens the panel

- **WHEN** the deployer opens a management panel on their own deployment
- **THEN** the panel opens and populates exactly as before this change
