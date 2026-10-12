# Design — add-cockpit-views（M4④b）

## Decisions

### D1 — summary 端点而非卡片端点
卡片=部署列表（registry 富化：name/paused——已有端点+轮询）×台账聚合（store-only）。
新端点只做后者：单 SQL 条件聚合（turns7d/minutes30d/usd30d 按 started_at 窗口）+
allowance 全量。零 registry/外部调用=快且不会因观测面抖动连坐。客户端 join。

### D2 — 成本口径
usd30d=非 waived 回合的 minutes×rate 求和（与 usageBoard.byAgent 同式）；展示为
「近 30 天 X 分钟 · $Y」水位（无上限条——部署成本没有硬 cap 语义，不伪造进度条）。

### D3 — 卡片保留全部管理动作
四面板（配置/记录/额度/允许清单）仍为卡片下方的展开面板（现有组件不动）——卡片是
概览层不是替代层；「在干活吗」由卡片答，「怎么调」仍一键可达。

### D4 — 任务进度条
spent/costCap 水位条（红区 ≥80%）+步骤 done/total 进度条；窗口显示剩余时间而非绝对
区间（详情保留绝对区间）。

## Risks / Trade-offs

- summary 暴露所有 slug 的聚合给任何验证身份——与部署列表同门（身份已验证）；
  聚合数值无敏感性（目录面 turns7d 已公开）。
