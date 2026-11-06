# wanxing-storage-longevity 设计

## rollup 进度驱动补算

现状：`rollupPass(48)` 固定回看 48h（observer.js:292），宕机>48h 即永久空洞。改法：

- `stats.db` 加 meta 行 `rollup_progress_hour`（最后一次已完整计算的 hour 桶）；
- `rollupPass` 起点=进度行，终点=当前 hour-1；上限=保留期（14d=336h，防首跑/坏进度全表扫）；
- 首跑/进度缺失：以「now-保留期」为起点（与 14 天窗对齐，天然有界）；
- 进度行随每个桶算完即推进（事务内），被杀后续算，已算桶幂等覆盖。

观测补齐验证法：本地构造 fleet-events.db，手工把进度行回拨 72h，跑 tick 后断言空洞时段 rollup 行存在。

## facade 清理 tick

routes.js 既有 60s sweep 附近加低频 tick（每 15min）：`wanxing_requests` 删 `created_at < now-7d`（幂等窗口语义只要「重放短期生效」——7d 与幂等保留惯例一致，env `WANXING_REQUESTS_TTL_DAYS` 可调）；`wanxing_mission_writebacks` 删已终态且 >30d（`WANXING_WRITEBACKS_TTL_DAYS`）。`wanxing_usage` 零触碰。删除行数进日志一行（可观测）。

## callback-audit 轮转

`callback-audit-YYYYMMDD.jsonl` 按日切，写当前日文件；tick 内清理 >14d 的旧文件（`WANXING_AUDIT_RETENTION_DAYS`）。读侧（如有）按通配查——grep 现无读方，风险低。

## PVC 备份方案（proposal 留白的裁决点）

**选型：集群内 CronJob + sqlite3 `.backup` + rsync over SSH 到 cheap-3**

- 每日 03:00（错开走查班）CronJob 挂两个 PVC 只读跑 `sqlite3 .backup`（在线安全快照语义）→ tar → 经 SSH（私钥挂 secret，复用既有 ssh-config 体系）rsync 到 `cheap-3:/opt/backups/wanxing/`，保留 14 份；
- 否决 litestream：需新增 S3 兼容端点与常驻组件，当前量级（2Gi+5Gi）日备足矣；
- 否决仅 kubectl cp 手动：无无人值守保障，回到「无备份」。
- 恢复演练：任务内做一次——取最近备份在 /tmp 解开，`sqlite3 PRAGMA integrity_check` + 行数对账（events/rollup 两表），记录在案。
- 说明：备份解决丢数据不解决可用性（单副本拓扑是现行裁决，不在本 change 翻）。

## PORTS.md 与注释清理（fd-infra-deploy）

补 31880（wanxing-web）/31881（fleet-observer）两行（PORTS.md:1-5 自称唯一台账）；删 observer.yaml:42 与 facade.yaml:42 两处过时 `TODO(go-live)` 注释。

## Non-goal 重申

不迁 Postgres；不做多副本/漂移；不改 rollup 表结构与查询面。
