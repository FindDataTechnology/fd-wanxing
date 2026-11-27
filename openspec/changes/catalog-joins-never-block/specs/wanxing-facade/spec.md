# Spec Delta

## ADDED Requirements

### Requirement: Catalog joins never block the request on snapshot expiry

目录读取（`GET /agents`、`GET /status`、控制台部署列表）所依赖的 join 快照——策展（curation）、集群
索引（cluster）、集群单元列表（cluster units）、外部系统声明（declarations）、近 7 天活跃（turns7d）
——SHALL 遵循 stale-while-revalidate：
快照新鲜时零上游读；快照过期时 SHALL 立即以上一份快照应答，并在后台执行一次单飞刷新，MUST NOT 让请求
原地等待刷新完成。

冷启动（从未成功加载过）SHALL 阻塞一次并等待首份快照；首份加载失败 SHALL 沿用既有降级语义
（该 join 无信号 / 空映射），MUST NOT 让整张目录失败或返回 5xx——目录的可达性不由任一 join 决定。

刷新失败 SHALL 保留上一份快照（既有 stale-on-hiccup 语义），MUST NOT 清空或回退为全空。

该要求不改变任何响应形状、缺省排序、TTL 数值或硬窗口语义。

#### Scenario: An expired join serves the last-known snapshot

- **WHEN** 某个 join 快照已超过 TTL 且刷新需要一次上游往返
- **THEN** 请求以上一份快照立即应答，刷新在后台进行，响应耗时与该上游往返无关

#### Scenario: A cold join blocks exactly once

- **WHEN** 进程启动后第一次读取目录，四个 join 均无快照
- **THEN** 请求等待首份快照加载完成后应答；后续请求不再付费等待

#### Scenario: Concurrent readers share one refresh

- **WHEN** 快照过期的瞬间有并发目录请求
- **THEN** 只发出一次上游刷新，所有请求立即拿到同一份上一份快照

#### Scenario: A failed refresh keeps the last-known maps

- **WHEN** 刷新失败（上游不可达或返回错误）
- **THEN** 目录继续使用上一份快照，受影响的 join 保持上次的语义（无策展字段仍渲染为未分组，活跃数保持上次读数）
