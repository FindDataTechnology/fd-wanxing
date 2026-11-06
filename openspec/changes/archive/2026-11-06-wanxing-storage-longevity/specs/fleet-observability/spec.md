## ADDED Requirements

### Requirement: Rollup 补算自进度驱动且覆盖整个保留窗口

hour×agent rollup 的补算 SHALL 由持久化的「上次已算进度」驱动（不再固定 48 小时上限），单次补算上限 SHALL 等于原始事件保留期（14 天）：服务恢复或重启后，凡仍在保留窗内的原始事件 MUST 全部进入 rollup，不因宕机时长产生永久统计空洞。

#### Scenario: 宕机 72 小时后恢复

- **WHEN** fleet-observer 停机 72 小时（超过旧 48h 上限）后恢复
- **THEN** 保留窗内的全部未算小时被补进 rollup，board 与 stats 面在该时段无空洞

#### Scenario: 进度持久且可重放

- **WHEN** 补算进行中进程再次被杀
- **THEN** 重启后从已持久化的进度续算，已算小时幂等覆盖不叠加
