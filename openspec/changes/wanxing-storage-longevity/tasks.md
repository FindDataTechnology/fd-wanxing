# wanxing-storage-longevity 任务清单

## 1. rollup 进度驱动补算（observer）

- [ ] 1.1 stats.db meta 加 `rollup_progress_hour` 行，rollupPass 改进度驱动（起点=进度、上限=保留期 336h、事务内推进）；验证=单测：进度回拨 72h 后一 tick 补齐空洞、再杀再起重放不叠加
- [ ] 1.2 首跑/进度缺失回退起点=now-保留期；验证=全新库首跑有界（≤336 桶）完成
- [ ] 1.3 本地全量测试绿（test-fleet-observer/test-stats-plane）；验证=npm test 过

## 2. facade 保留策略

- [ ] 2.1 清理 tick（15min）：wanxing_requests 7d / writebacks 终态 30d（env 可调），usage 零触碰；验证=单测旧行清/新行留/usage 行数不变
- [ ] 2.2 callback-audit 按日轮转+14d 清理；验证=单测跨日切文件、旧文件被清
- [ ] 2.3 清理动作日志一行（删行数）；验证=本地跑 tick 见日志

## 3. PVC 备份

- [ ] 3.1 CronJob 落 fd-infra-deploy（03:00，两库 .backup→tar→rsync cheap-3，保留 14 份，SSH key 挂 secret）；验证=CronJob 首跑成功、cheap-3 目录见当日备份
- [ ] 3.2 恢复演练：取备份解 /tmp，integrity_check+两表行数对账；验证=演练记录落本 change 目录
- [ ] 3.3 备份失败告警路径（CronJob 失败非零退出可被巡检发现）；验证=人为断 SSH 演练一次失败可见

## 4. 台账与注释（fd-infra-deploy）

- [ ] 4.1 PORTS.md 补 31880/31881 两行；验证=grep 两端口各一行且与实际 Service 对上
- [ ] 4.2 删 observer.yaml:42 / facade.yaml:42 过时 TODO(go-live) 注释；验证=两文件无该残留

## 5. 收口

- [ ] 5.1 `openspec validate wanxing-storage-longevity --strict` 过
- [ ] 5.2 生产验证：observer 滚产后 board/stats 正常、进度行存在；facade 滚产后 60s sweep+15min tick 日志正常、次日 cheap-3 见备份；验证=三项记录在案
