# Proposal

## Why

公开目录的一次读取要打 **27 次串行单条 registry 读**，而这 27 次在 registry 侧有一个等价的一次性列表读（同 45 条、同 metadata，198ms vs 3485ms）。更糟的是那份 per-slug 缓存**没有 single-flight**：60 秒 TTL 一到，每个并发访客各自重拉 27 次。

2026-11-23 在 fd-prod 门面 pod 内实测：

| 并发 | 一次目录请求耗时 |
|---|---|
| 1 | 0.8s |
| 3 | 9.5s |
| 6 | 16.5s |
| 12 | 31.8s |
| 20 | 49.9s |

同批对照排除了链路因素：同一分钟内 20 并发静态资源 0.20s、20 并发单张 agent card 0.16s。耗时随并发线性叠加（≈2.6s/并发），正是「每个请求各干一遍全量重活」的特征。

三个消费面各有一份同样的 27 次循环：目录 `GET /agents`、公开状态 `GET /status`（落地页读数 + 页脚）、控制台部署列表 `GET /console/deployments`。落地页一次首屏同时打 `/status` 与 `/agents`，等于两遍。

## What Changes

- **registry 条目改由一份快照提供**：门面新增进程内 registry 条目快照，经 registry 的列表端点分页读取（跟随 `has_next`），TTL 60s、single-flight、失败保留上一份（stale-on-hiccup）。目录、公开状态、控制台部署列表三处共用这一份。
- **`entryFor(slug)` 不再发请求**：改为查快照。写路径（暂停/恢复的「读完整 entry → 改 metadata → PUT」）保留单条读，语义不变。
- **上游读次数与部署数解耦**：一次目录读取的上游读次数是 1（快照新鲜时 0），不再随部署数增长。
- **`clusterUnits()` 纳入同一 TTL 缓存**：今天它每个请求现算 `clusterMap()` + `listDeployments()`。
- **列表端点缺失的四个字段按可核实的来源合成**，逐条有实测依据（见 design.md）：`version` 取部署台账的 `dep.version`（与 `metadata.packVersion` 在 34/34 个在役部署上一致）、`capabilities` 由 `streaming` 还原、`provider` 由 `provider_organization` + `provider_url` 还原、`examples` 目录不提供（实测 45/45 均未声明，零可见变化）。
- **详情视图改读卡片面**：列表的 `skills` 只有名字、没有 `description`，而详情页要渲染描述。详情页改读 `/.well-known/agent-card.json`（1 次读、字段全），同时去掉 web 侧为找一个 agent 而做的一次 `page_size=200` 全量目录读。
- **BREAKING（仅数值）**：目录与卡片的 `version` 由今天陈旧的 `"1"` 改为真实包版本（24 个 agent 会从 `v1` 变成 `v6`/`v10`/`v11` 等）。契约原文即「Pack version as published」，这是改对；但消费者会看到数字变化。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-facade`：目录的取数由「逐 slug 单条读 registry」改为「一份可共享的 registry 条目快照」，并新增快照语义（TTL/single-flight/stale-on-hiccup/上游读次数与部署数解耦）；`version` 字段语义明确为「已发布的包版本，取自部署台账，与 registry 条目的陈旧 `version` 无关」。
- `wanxing-web`：详情视图的取数改为卡片面（`agent-card.json`），因此技能描述与版本在详情页与卡片面对齐；目录页不再为详情做一次全量目录读。
- `wanxing-borrowed-contracts`：读取借用 registry 的**列表**读面 SHALL 跟随 `has_next` 读全，MUST NOT 把一页当作全集（registry 默认 `limit=20`，静默截断是静默错误）。

## Non-goals

- **不改 registry 本身**。它把 `version` 写成陈旧值、把 `provider` 拍平、把 `skills` 降为名字——这些都是 registry 的对外形状，不属于本仓。本仓只消费，不做跨仓修复。
- **不改任何对外响应形状**。`GET /agents`、`/status`、`/console/deployments` 的键集合与语义不变（`version` 的取值更正除外）。四个外部消费者（谦面供给脊柱、壹座 ops-console、柏讯工单链、识律控制台）不受影响。
- **不做 registry 侧缓存**。门面的快照已经让上游读降到每 60 秒一次；在 registry 加缓存是另一个仓的另一个决定。
- **不动七事实状态词汇、不动 `sort=activity` 排序规则、不动计费与准入**。
- **不新增指标端点**。快照的新鲜度沿用既有 `status_as_of` 表达。

## Impact

- `services/wanxing-facade/a2a.js` — 新增条目快照；`entryFor` 改为查表；`clusterUnits` 入缓存；`publicCard` 的 `version` 来源。
- `services/wanxing-facade/routes.js` — 快照的接线与注入缝；控制台列表改读快照。
- `services/wanxing-facade/console.js` — 部署列表的逐条 enrichment 改查快照；`visibility` 单独读（写路径保留）。
- `wanxing-web/src/views/AgentDetailView.jsx` — 取数改卡片面。
- `scripts/test-wanxing-facade.mjs`、`scripts/test-public-contract.mjs`、`wanxing-web/test/views.test.jsx` — 新增「N 条只打一次上游」「single-flight」「stale-on-hiccup」「四个合成字段」断言；详情改卡片面后的断言。
- 无数据迁移，无 k8s 清单变化（镜像沿用既有镜像线）。
