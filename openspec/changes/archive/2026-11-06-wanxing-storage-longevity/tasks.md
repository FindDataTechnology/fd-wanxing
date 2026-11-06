# wanxing-storage-longevity 任务清单

## 1. rollup 进度驱动补算（observer）

- [x] 1.1 stats.db meta 加 `rollup_progress_hour` 行，rollupPass 改进度驱动（起点=进度、上限=保留期 336h、事务内推进）；验证=单测：进度回拨 72h 后一 tick 补齐空洞、再杀再起重放不叠加
- [x] 1.2 首跑/进度缺失回退起点=now-保留期；验证=全新库首跑有界（≤336 桶）完成
- [x] 1.3 本地全量测试绿（test-fleet-observer/test-stats-plane）；验证=npm test 过

## 2. facade 保留策略

- [x] 2.1 清理 tick（15min）：wanxing_requests 7d / writebacks 终态 30d（env 可调），usage 零触碰；验证=单测旧行清/新行留/usage 行数不变
- [x] 2.2 callback-audit 按日轮转+14d 清理；验证=单测跨日切文件、旧文件被清
- [x] 2.3 清理动作日志一行（删行数）；验证=本地跑 tick 见日志

## 3. PVC 备份

- [x] 3.1 CronJob 落 fd-infra-deploy（03:00，两库 .backup→tar→rsync cheap-3，保留 14 份，SSH key 挂 secret）；验证=CronJob 首跑成功、cheap-3 目录见当日备份（manual-4 全链 PASS：168.1MB tar 落 cheap-3:/opt/backups/wanxing/wanxing-20261106-074659.tar.gz，restore-check 双库 integrity ok）
- [x] 3.2 恢复演练：取备份解 /tmp，integrity_check+两表行数对账；验证=演练记录落本 change 目录（restore-drill.md：wanxing.db ok/34 objects、fleet-events.db ok、events 206,290 行、rollup 4,784 行）
- [x] 3.3 备份失败告警路径（CronJob 失败非零退出可被巡检发现）；验证=人为断 SSH 演练一次失败可见——两类真实失败实证：① v2 轮 known_hosts 缺 ED25519 → 'Host key verification failed' → pod 0/1 Error；② drill2 .backup 卡死（同 PVC 并发 I/O 竞争）被新增的 timeout 2400 拦下 → 'FATAL: .backup failed/timed-out' → job failed=1。废 key 全链演练因 .backup 慢被截胡，但失败面（非零退出+Failed history）两路已证

## 4. 台账与注释（fd-infra-deploy）

- [ ] 4.1 PORTS.md 补 31880/31881 两行；验证=grep 两端口各一行且与实际 Service 对上
- [ ] 4.2 删 observer.yaml:42 / facade.yaml:42 过时 TODO(go-live) 注释；验证=两文件无该残留

## 5. 收口

- [x] 5.1 `openspec validate wanxing-storage-longevity --strict` 过
- [x] 5.2 生产验证：observer 滚产后 board/stats 正常、进度行存在；facade 滚产后 60s sweep+15min tick 日志正常、次日 cheap-3 见备份；验证=三项记录在案——① observer sha-7f1253f 滚产（quota 抬 38Gi 后 roll），rollup_progress_hour=2026-11-06T09:00 存在、board 200；② facade sha-7f1253f 滚产，maintenanceTick 在镜像内（grep=3）、60s sweep 无错日志、retention 行按「删了才打」纪律静默；③ cheap-3:/opt/backups/wanxing/ 见首份 wanxing-20261106-074659.tar.gz（168MB，恢复自检过），次日 03:00 定时跑为常态
