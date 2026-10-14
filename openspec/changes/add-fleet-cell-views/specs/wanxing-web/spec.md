## ADDED Requirements

### Requirement: 运维视图渲染统一舰队视图

The ops view SHALL render a short-term execution section from the board's `cells`/`shortterm`
segments: a summary line (cells, running, queued, worker occupancy) and one row per cell
(identity, running/queued, worker pool, recent terminal outcomes, sample age). Runner rows
SHALL display a pod-density badge when the runner's stats carry a truthy `pod` field; an
absent field displays nothing (degrade open). When the board carries no `cells` segment
(observer not yet upgraded), the section SHALL show an explicit not-upgraded note instead of
breaking.

#### Scenario: 短期执行区随 board 数据渲染

- **WHEN** the board carries `cells` with two entries and `shortterm` sums
- **THEN** the ops view shows the summary line and two cell rows with their counts

#### Scenario: observer 未升级时降级提示

- **WHEN** the board response has no `cells` key
- **THEN** the section renders the not-upgraded note and the rest of the view is unaffected

#### Scenario: pod 密度徽标

- **WHEN** a runner's stats carry `pod: true`
- **THEN** its row shows the density badge; runners without the field show none
