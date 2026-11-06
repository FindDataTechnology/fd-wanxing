# 恢复演练记录（wanxing-storage-longevity 3.2）

- 日期：2026-11-06
- 备份产物：cheap-3:/opt/backups/wanxing/wanxing-20261106-074659.tar.gz（168.1MB，CronJob wanxing-backup 首跑产出）
- 演练动作：cheap-3 上 /tmp/wx-restore-drill 解开 tar → alpine:3.20 (sqlite) 逐库检
- 结果：
  - `wanxing.db`：`PRAGMA integrity_check` = ok；schema objects 34（16 张表，wanxing_requests 7 列含 request_hash 硬化列）
  - `fleet-events.db`：`PRAGMA integrity_check` = ok；events 206,290 行；rollup_agent_hour 4,784 行
- 行数对账：与生产库量级一致（events 14d 保留期 + rollup 累计），无空库/截断迹象
- 结论：备份可恢复，演练通过。CronJob 每跑自带的 restore-check（脚本尾部）与本次人工演练同一语义。
