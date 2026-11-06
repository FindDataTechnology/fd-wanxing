## ADDED Requirements

### Requirement: 台账辅助行有保留策略

`wanxing_requests` 幂等行与 `wanxing_mission_writebacks` SHALL 按保留窗清理（env 可调，默认覆盖幂等/回写语义所需窗口），`wanxing_usage` 等账本行 SHALL 长存不受清理影响；`callback-audit.jsonl` SHALL 按日轮转并限量（保留 N 天，默认 14），轮转文件可查。

#### Scenario: 幂等行不无限增长

- **WHEN** 幂等行超过保留窗
- **THEN** 清理任务删除旧行，重放该 key 得到「未知 key」语义（可开新回合），账本 usage 行不受影响

#### Scenario: 审计文件可追溯且不失控

- **WHEN** callback 审计跨天写入
- **THEN** 按日开新文件，超保留期的轮转文件被清理，磁盘占用有界

#### Scenario: 账本永不被清

- **WHEN** 清理任务执行
- **THEN** `wanxing_usage`（结算/计费事实源）行数只增不减
