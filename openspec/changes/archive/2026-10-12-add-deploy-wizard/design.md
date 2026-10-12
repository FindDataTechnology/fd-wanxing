# Design — add-deploy-wizard（M4① 部署向导）

## Context

萬星用户舰队第一切片（伞文档 §M4①「配得好」）。所有 knob 的服务端地基在产：facet deploy 端点
已收 rhythms/budgets/models/notifyChannel/billingKeys（+ paas `add-deploy-agent-selection` 补
agents 子集）；console 已有 config/callers/host-allowance 端点。本 change 是**编排层**：把部署
体验从「知道字段名的人才能用」变成「分步引导」。

## Goals / Non-Goals

- Goals: 四步向导（包→agent→配置→计费/通知）+ 结果态可见性收尾（额度/allowlist 前移）；
  facade 载荷转发扩展；my/packs 带 modelWhitelist 提示。
- Non-Goals: 试驾预调（伞文档挂账，向导主体稳后再议）；目录筛选（M4②）；套装（M4③）；
  console IA 重构（M4④ 前置，独立切片——本片只重构 deploy-panel 内部，不动 ConsoleView 骨架）。

## Decisions

### D1 — 向导状态机：单组件内的 step 游标 + 草稿对象

ConsoleView 已 1039 行；向导抽成同文件内独立子组件 `<DeployWizard>`（props: packs 列表 +
authFetch + onDone），内部 `step` state（1-4 + done）。不引入路由（伞文档 hash 纪律属谦面壳，
萬星 console 是 #/console 单面）。草稿 `draft = {packId, version, agents:Set, cfg:{agentId:{model,
budget,rhythmPreset,rhythmJson}}, billingKey, notifyChannel}`——步骤间不丢输入（spec 场景）。

### D2 — 配置步的节奏输入：预设 + 自定义双轨

预设（不设/每 15 分钟/每小时/每天 09:30）映射到 entries 形状 `[{every:"15m"}]` 等；「自定义」
切 textarea 收 JSON（与既有 config 面板同形状、同校验文案）。空 = 不传（走声明默认）——**不传
null**（null 是显式清除，部署初值不该带清除语义；facet 三态契约：缺席=声明默认）。

同律适用于 budget/model：留空即整个键缺席，不传 null。

### D3 — facade 转发：选中集映射 + 原样透传

```js
const selected = Array.isArray(req.body?.agents) && req.body.agents.length
  ? req.body.agents.map(String) : serving.map((a) => a.id);
const body = {
  ...(req.body?.agents ? { agents: selected } : {}),
  billingKeys: Object.fromEntries(selected.map((id) => [id, billingKey])),
  ...(notifyChannel ? { notifyChannel: Object.fromEntries(selected.map((id) => [id, notifyChannel])) } : {}),
  ...(req.body?.models ? { models: req.body.models } : {}),
  ...(req.body?.budgets ? { budgets: req.body.budgets } : {}),
  ...(req.body?.rhythms ? { rhythms: req.body.rhythms } : {}),
};
```

models/budgets/rhythms 形状不在 facade 重验（facet 是唯一校验权威，透传 400）——但做**最小
形状门**：若提供必须是纯对象（非数组），否则 400 指名（防字符串穿透 JSON 层）。载荷上限
4kb→16kb（rhythms JSON 可能长；facet 端点自身 64kb）。

### D4 — my/packs 富化：deployableAgents 带 modelWhitelist

detail 调用已在循环里（读 manifest.agents[].serving）；map 时带出
`modelWhitelist: a.serving.modelWhitelist`（无声明则 undefined，不伪造空数组——spec 场景）。

### D5 — 可见性收尾：结果步复用既有端点

结果步（step=done）渲染分享卡（share 端点，现状）+ 两个收尾块：
- 对话额度：`PUT .../host-allowance`（复用 console 已有逻辑的轻量内联版）；
- API 调用者：`POST .../callers`（email 输入）。
失败 inline 显示，不回滚部署（spec 场景）。**不做**新的「可见性」服务端概念——pack 公私有
仍是发布时语义，向导只把「部署后马上能开」的两个面搬过来。

### D6 — 依赖时序：paas 端点先行

实施顺序 = paas `add-deploy-agent-selection` 先上（三面滚动），fd-wanxing 后上。facet 未升级
时向导传 agents 会得 400「unknown key」级错误——透传可见、不破坏老表单路径（老路径不传
agents）。不做 feature flag、不做版本探测（诚实失败优于暗探测）。

## Risks / Trade-offs

- **ConsoleView 继续变长**：向导子组件自包含（状态不外溢），IA 重构（M4④）时整块搬走。
- **rhythms 自定义 JSON 用户错**：facet 400 文案直接展示（已是中文友好形状，validateRhythm
  的错误指名字段）。
- **多 agent pack 全选 + 单键**：facet 有 duplicate-key 拒收（一键不能服务两个 agent）——
  向导在 >1 选中时提示「每个 agent 需各自的键」并把计费键输入改成 per-agent？**不**——v1
  保持单键映射选中集，>1 选中时 facet 拒收文案会教育用户；与 selfservice v1 行为一致（今天
  全量部署同样撞这个门）。向导只在计费步加一行提示文案。

## Migration Plan

无 schema/配置变化。部署 = facade 镜像滚 + web 镜像滚（wanxing-web 由 facade 容器服务静态面？
——实测：web 是独立 deployment `wanxing-web`，镜像独立滚）。

## Open Questions

无。
