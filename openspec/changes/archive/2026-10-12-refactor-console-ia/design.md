# Design — refactor-console-ia（M4④ 前置）

## Decisions

### D1 — 三标签而非两视图
伞文档定「我的舰队/我的任务」两视图=**部署者视角的产品面**；机群总览/时间线/套餐管理是
ops 面，硬塞进两视图会污染部署者 IA。第三标签「运维面」收纳，可见性与今天一致（登录
即可读，管理动作仍走 ops 令牌门——无行为变化）。

### D2 — 保留字路由
`#/console/missions`、`#/console/ops` 为保留子路由；其余 focusSlug 一律按部署 slug 处理
（开舰队标签的配置面板——壹座「去配置」深链契约不变）。

### D3 — 状态随视图走
每个视图自带 state+loaders（从单体剪切）；壳只持有 tab。深链 useEffect 在壳层：slug→
切舰队+FleetView 收 focusSlug；FleetView 内部沿用「token 就绪即开面板」的现有 effect。

## Risks / Trade-offs

- 按需加载=切标签首载有加载态（改进非回归）；深链行为逐条浏览器回归兜底。
