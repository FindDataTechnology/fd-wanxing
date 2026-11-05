# wanxing-contract-hardening 设计

## 超时值与参数化

| 路径 | 默认 | env |
|---|---|---|
| registry serving doFetch | 8s（回合转发略宽） | `WANXING_REGISTRY_TIMEOUT_MS` |
| packs internal | 5s（快照缓存已在fresh/stale窗内兜底） | `WANXING_PACKS_TIMEOUT_MS` |
| sub2api admin | 8s（admission 同步路径；key 探活保持既有 5s） | `WANXING_SUB2API_TIMEOUT_MS` |

实现=统一 `fetchWithTimeout`（AbortController）进 `lib/`，三处调用点换用；错误形态沿用各路径既有结构化错误（不新增错误码，复用 PACKS_INTERNAL_UNAVAILABLE 一类，补 timeout 归类）。memory.js 既有 5s 不动。

## fail-fast 语义

启动断言：`SUB2API_BASE_URL`/`PACKS_INTERNAL_BASE_URL` 二者缺一即 `process.exit(1)` 并打印缺失变量名。**选拒启而非 degraded**：这两条是回合/目录主路径，degraded 态只对可选依赖合理；现网四组件 env 已齐（部署真态核实过），拒启无生产风险。

## spool 格式

`{WANXING_DATA_ROOT}/fleet-spool.jsonl`：追加写事件行（与上报 body 同形），内存队列=消费视图；启动时回灌未确认行（确认=flush 成功后截断水位）；上限 50k 行（内存 2 万 + 盘 3 万），溢出丢最旧并 `droppedEvents` 计数（经既有事件上报一并进 board）。确定性 id 保证 observer 端 `INSERT OR IGNORE` 幂等，重放零双计。落盘用 append+定期 fsync（事件吞吐低，无性能顾虑）。

## 清单去 IP 字面量

三处：agent-runner-serving.yaml:150（→observer）、facet.yaml:107（→facade）、platform.yaml:104（→facet）。同集群内换 Service DNS（`http://wanxing-facade:3080` 等）；runner→observer 的跨节点 NodePort `100.64.0.8:31881` 属 mesh 面——换 `cheap-ts` 集群内可达的 DNS 不可行（runner 是 platform 镜像宿主网络外?）——**核实后处理**：若 runner pod 在集群内则换 Service 名，若确实走 tailnet 则保留 IP 但加 justification 注释（spec 允许带注释例外）。platform.yaml 的 facet ClusterIP（10.43.71.119）同类核实（platform hostNetwork 无 cluster DNS 的老坑——若无法用 DNS，走记录在案的例外+注释）。

## Non-goal 重申

不做熔断器/重试库；observer 侧零改动；不改借用契约形状。
