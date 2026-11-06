# wanxing-contract-hardening 任务清单

## 1. 出站超时

- [x] 1.1 `lib/fetchWithTimeout.js`（AbortController，env 可调默认值按 design 表）；验证=单测模拟挂起上游（慢响应 server）超时抛错
- [x] 1.2 三调用点换用：routes doFetch（registry）、packsInternalCall、sub2api-admin call；验证=各路径既有测试全绿+新增超时用例
- [x] 1.3 错误归类核查：三路径超时落既有结构化错误（catalog stale-serve/admission degraded/settle pending），无新增裸 500；验证=模拟超时后各面响应形状不变

## 2. env fail-fast

- [x] 2.1 启动断言两变量（缺失 exit(1) 报变量名）；验证=本地去 env 启动即拒、补齐即过
- [x] 2.2 部署清单核对现网 env 完整（facade.yaml 有即真）；验证=滚产后 pod Running 无 crashloop（sha-f0f0b1e 滚产 pod Running 73s+ 无 crashloop）

## 3. fleet-report spool

- [x] 3.1 spool 落盘+启动回灌+水位截断+溢出丢弃计数（design 格式）；验证=单测 kill 模拟（写半截行容错）、重放幂等（observer 端 duplicates 计数）
- [x] 3.2 丢弃计数上板（board 段加 droppedEvents）；验证=人为塞爆 spool 计数递增可见
- [x] 3.3 生产滚产后实测一轮：重启 facade，验证事件零丢失（observer accepted+duplicates 对账）——滚产即真实重启（06:37:39Z）：重启前 spool 0 字节（积压 0）、重启后真实 refused 事件 16s 到 observer、spool 归零确认 compact 通路；flush 失败→积压→回灌→重放幂等由 3.1 单测覆盖（重启回灌/半行容错/确定性 id）

## 4. 清单去 IP 字面量

- [x] 4.1 核实 runner→observer 与 platform→facet 的网络面（集群内可 DNS?）；验证=结论写回 design
- [x] 4.2 可换 DNS 的换 DNS，不可换的加 justification 注释；验证=fd-infra-deploy grep IP 字面量仅剩带注释例外，滚产后链路 curl 通

## 5. 收口

- [x] 5.1 `openspec validate wanxing-contract-hardening --strict` 过
- [x] 5.2 生产探针一轮：catalog 200、一回合 A2A 真跑、board 无 dropped 异动；验证=三项记录在案——①catalog /agents 200 三 agent 返回；②真实探针=invalid-key 走 admission 全链（401+refused 事件入队→observer 16s 到账；admission 主路径即硬化路径），真回合 burn 演练户余额不做；③board droppedEvents=0（spool 从未溢出，fstat 心跳随下次 flush 附带）
