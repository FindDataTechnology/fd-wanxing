# Spec Delta

## ADDED Requirements

### Requirement: The public catalog can order its list by activity

公开目录（`GET /api/wanxing/v1/agents`）SHALL 支持可选参数 `sort`。取值为 `activity` 时，返回列表按
一条全序排列：精选在前；其余按实例状态分组——在役 → 尚无调用 → 状态未知 → 已暂停；组内按 `turns7d`
降序；仍并列则按 `name` 升序（决定性，不留并列）。

`sort` 缺失或取值未定义时，响应 SHALL 与引入该参数之前完全相同（registry 顺序）。

#### Scenario: 精选与在役在前

- **WHEN** 调用方请求 `?sort=activity`
- **THEN** 精选条目排在所有非精选条目之前，在役条目排在所有「尚无调用」条目之前

#### Scenario: 同组内按 7 天回合降序

- **WHEN** 两个条目同属在役组，`turns7d` 分别为 9 与 2
- **THEN** `turns7d` 为 9 的条目排在前面

#### Scenario: 并列时有决定性次序

- **WHEN** 两个条目同组且 `turns7d` 相等
- **THEN** 按 `name` 升序决定先后，同一份数据两次请求得到同一顺序

#### Scenario: 已暂停排在最后

- **WHEN** `?sort=activity` 的响应里同时含 serving、idle 与 paused 三类条目
- **THEN** paused 条目排在全部 serving 与 idle 条目之后

#### Scenario: 未知取值按缺省处理

- **WHEN** 调用方请求 `?sort=recent`（未定义的取值）
- **THEN** 按缺省 registry 顺序返回，不报错

### Requirement: Activity ordering reorders without filtering

`sort` SHALL 是纯排序：它 MUST NOT 过滤任何条目、MUST NOT 改变条目字段、MUST NOT 影响 `total` 与
`facets` 计数（`facets` 仍统计未过滤的公开全量列表）。排序 SHALL 发生在分页之前，因此 `page` /
`page_size` 切的是排好序的列表。

#### Scenario: 排序先于分页

- **WHEN** 调用方请求 `?sort=activity&page=2&page_size=10`
- **THEN** 返回的是排好序列表的第 11–20 条，而非未排序列表第 11–20 条再排序

#### Scenario: 条目集合与计数不变

- **WHEN** 同一公开集合分别以无参数与 `?sort=activity&facets=1` 请求
- **THEN** 两者的 `total`、`facets.total` 与 slug 集合相等，仅顺序不同

#### Scenario: 无参数调用保持既有形状

- **WHEN** 调用方请求 `GET /agents`（无 `q` / `category` / `featured` / `cluster` / `sort`）
- **THEN** 响应与引入 `sort` 之前完全一致（全量列表，registry 顺序）
