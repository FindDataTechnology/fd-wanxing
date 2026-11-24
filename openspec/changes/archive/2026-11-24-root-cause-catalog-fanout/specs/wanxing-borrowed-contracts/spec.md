# Spec Delta

## ADDED Requirements

### Requirement: A paged list read of a borrowed registry is followed to exhaustion

读取借用 registry 的列表读面时，调用方 SHALL 跟随 `has_next` 读全，MUST NOT 把一页当作全集。registry 的列表默认每页 20 条并返回 `{ total_count, limit, offset, has_next }`，把第一页当全集会在无任何错误的情况下静默漏掉尾部条目。

读取 SHALL 有界：页数上限与总时间预算 SHALL 明确，触顶时调用方 SHALL 显式记录「读到的条数少于上报总数」的事实，MUST NOT 把截断后的集合当作完整集合继续推理。

#### Scenario: Tail entries are not silently dropped

- **WHEN** registry 上报 `total_count` 大于一页的 `limit`
- **THEN** 调用方继续按 `offset` 读取直到 `has_next` 为假，或直到触达页数/时间上限

#### Scenario: Truncation is named, not hidden

- **WHEN** 读取在触达上限时仍有 `has_next`
- **THEN** 调用方记录一条明确的截断事实（含已读条数与上报总数），而不是返回一个看起来完整的集合

#### Scenario: A registry that ignores offset does not loop forever

- **WHEN** registry 对 `offset` 无反应、重复返回同一页
- **THEN** 调用方检测到重复页并停止，不无限循环
