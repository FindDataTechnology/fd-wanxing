## ADDED Requirements

### Requirement: board 携带 cell 短期执行段

The ingest SHALL accept the `cell_stats` event kind (enumerated whitelist — no wildcard), and
the board SHALL carry a `cells` object holding the freshest `cell_stats` payload per cell
identity within a 30-minute window (same shape as the runners segment), plus a `shortterm`
rollup: the number of reporting cells, summed in-flight executions (running / queued), and
summed worker-pool occupancy (busy / idle / cap). Cell identities SHALL NOT enter the
`agents_total` count or the `states` distribution — those remain resident serving-agent scopes.

#### Scenario: cell_stats 摄取并合成为 cells 段

- **WHEN** two `cell_stats` events with distinct cell identities ingest within the window
- **THEN** the board's `cells` object carries one entry per identity with the freshest payload,
  and `shortterm` sums their executions and worker occupancy

#### Scenario: 旧事件不出现，空窗口保形

- **WHEN** the window holds no `cell_stats` events
- **THEN** `cells` is an empty object and `shortterm` reports zero counts (the segment stays
  present, never absent)

#### Scenario: cell 身份不污染常驻口径

- **WHEN** `cell_stats` events ingest alongside runner agent events
- **THEN** `agents_total` and `states` count only the resident agents, exactly as before

#### Scenario: 白名单之外的 kind 仍被拒

- **WHEN** an event with an unknown kind posts to ingest
- **THEN** the batch is refused with 400, as before
