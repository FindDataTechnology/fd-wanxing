# Spec Delta

## ADDED Requirements

### Requirement: Registry entries are served from one shared snapshot per read

门面 SHALL 维护一份进程内的 registry 条目快照，作为目录（`GET /agents`）、公开状态（`GET /status`）与控制台部署列表（`GET /console/deployments`）读取 registry 条目的唯一来源。快照 SHALL 经 registry 的列表读面获得，MUST NOT 由逐 agent 的单条读拼装。

一份快照刷新 SHALL 只向 registry 发出一次逻辑读取；一次请求的上游读次数 SHALL 与已部署 agent 的数量无关。快照新鲜时，一次目录请求的 registry 读次数 SHALL 为 0。

快照 SHALL 以 60 秒 TTL 刷新，并发刷新 SHALL 合并为一次（single-flight）。刷新失败时 SHALL 继续提供上一份快照（stale-on-hiccup），MUST NOT 因一次上游失败清空目录。

#### Scenario: One logical read serves N deployments

- **WHEN** 已部署 27 个 agent 且快照新鲜
- **THEN** 一次目录请求产生的 registry 读为 0 次；快照过期后的第一次请求产生 1 次逻辑读取
- **AND** 单条读（`GET /api/agents/{path}`）不在目录路径上被调用

#### Scenario: Concurrent readers share one refresh

- **WHEN** 快照过期后有 20 个并发目录请求到达
- **THEN** 上游只收到一次列表读取，20 个请求共享同一份结果，且总耗时不随并发数线性增长

#### Scenario: Upstream hiccup keeps serving

- **WHEN** 一次刷新失败，且上一份快照仍在硬过期窗口内
- **THEN** 目录、公开状态与控制台列表继续用上一份快照应答，不返回错误

#### Scenario: A deployment absent from the registry is absent from the catalog

- **WHEN** 一个部署在 registry 中没有对应条目
- **THEN** 该条目不出现在目录中，且不产生一条伪造的占位条目
- **AND** 结果与逐条读该 agent 得到 404 时的可见行为一致

#### Scenario: Private entries stay out of the public faces

- **WHEN** 快照中含 `visibility: private` 的条目
- **THEN** 目录、公开状态与公开卡片面都不呈现它，与快照引入之前的判定一致

### Requirement: Synthesized entry fields carry a documented source

列表读面不携带 registry 单条读面的全部字段。门面 SHALL 按下表合成这些字段，MUST NOT 用占位值或臆测值填充：

| 字段 | 来源 |
|---|---|
| `version` | 部署台账的 `dep.version`；该部署不在台账中时，退回条目的 `metadata.packVersion` |
| `capabilities` | 条目的 `streaming` 标志 → `{ streaming: true }`；为假时为空对象 |
| `provider` | 条目的 `provider_organization` / `provider_url` → `{ organization, url }` |
| `examples` | 不提供（列表读面不携带；目录与卡片面在该字段缺席时保持既有形状） |

`version` SHALL 是**已发布的包版本**，MUST NOT 是 registry 条目上陈旧的 `version` 字段值。

#### Scenario: version is the published pack version

- **WHEN** registry 条目的 `version` 为 `"1"` 而部署台账中该 agent 的版本为 `10`
- **THEN** 目录行与公开卡片的 `version` 为 `10`

#### Scenario: capabilities reflects the declared streaming flag

- **WHEN** 条目的 `streaming` 为真
- **THEN** 卡片面的 `capabilities` 为 `{ streaming: true }`；为假时为空对象，两者均与逐条读该条目得到的值相等

#### Scenario: provider keeps the public redaction rule

- **WHEN** 条目的 `provider_url` 指向非公网可达地址
- **THEN** 卡片面照既有脱敏规则移除 `url` 键，只留 `organization`

### Requirement: Cluster units share the same snapshot cadence

集群单位列表 SHALL 与 registry 条目快照同节奏缓存；MUST NOT 在每次请求时重新推导集群索引与部署列表。

#### Scenario: Repeated catalog reads do not recompute units

- **WHEN** 同一分钟内多次请求目录
- **THEN** 集群单位只推导一次，后续请求复用该结果

## MODIFIED Requirements

### Requirement: Deployment bookkeeping snapshot serves resolution and change detection

The facade SHALL maintain an in-process cached snapshot of the deployment bookkeeping (the packs internal API), refreshed on a TTL with single-flight merging, indexed by slug for O(1) resolution. When the source is unreachable the last snapshot SHALL be served stale (matching the registry-entry snapshot's semantics); staleness beyond a hard window (5 minutes) SHALL degrade to the explicit source-unavailable error rather than serving an indefinitely stale catalog. Snapshot refreshes SHALL compute the deployment diff (added/removed/changed) via an exported pure function, so the fleet observer's bookkeeping-change detector (fd-wanxing program slice ③) reuses the same logic by minimal copy until the facade extraction converges it.

#### Scenario: Source hiccup serves stale

- **WHEN** a refresh attempt fails within the hard staleness window
- **THEN** resolution and the catalog continue serving the last snapshot without error

#### Scenario: Hard staleness degrades explicitly

- **WHEN** the snapshot has been unreachable for longer than the hard window
- **THEN** catalog and card routes respond with the explicit source-unavailable error instead of a stale list

#### Scenario: Diff detects bookkeeping changes

- **WHEN** a refresh observes deployments added, removed, or changed versus the previous snapshot
- **THEN** the exported diff function reports exactly those three buckets, and an unchanged refresh reports all three empty

#### Scenario: The deployment snapshot and the registry-entry snapshot are independent

- **WHEN** the deployment bookkeeping snapshot is fresh but the registry-entry snapshot cannot be refreshed
- **THEN** enumeration still uses the last-known registry entries, and the two snapshots' staleness do not substitute for one another
