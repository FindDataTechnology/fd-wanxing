# add-catalog-discovery

## Why

M3 ② 的消费半边：基座（serving.card.examples，paas add-agent-card-examples）就位后，目录要把它变成发现力——访客看到的不只是一段描述，而是「试问」一键直达；卡片详情（技能/slug/可对话徽标）就地展开。

## What Changes

- **facade 透传**：publicCard 与目录行在 registry 卡片声明 examples 时原样携带（缺省形状不变）。
- **目录卡片富化**：可对话徽标上移、试问示例（≤3 条，点击直达 `#/chat/<slug>?q=<示例>`；不可对话 agent 示例只读展示）、技能与 slug 折叠详情。
- **对话预填**：ChatView 读 `?q=` 一次性预填输入框（只填不发——访客自己按发送）。

## Capabilities

### Modified Capabilities

- `wanxing-facade`: 卡片与目录携带 examples（对既有 chatability 标记 requirement 的场景增补——ADDED scenario 级 delta）。

## Impact

- 代码：`services/wanxing-facade/a2a.js`（两处透传）、`wanxing-web/CatalogView.jsx`（卡片富化）、`ChatView.jsx`（?q 预填）。
- 上线：fd-wanxing 镜像（facade+web）；examples 真数据依赖带声明的 pack 重新部署（planner 等存量卡片不带该字段，形状不变）。

## Non-goals

- 不做目录服务端搜索/分类（现客户端过滤+分页够用；量大再议）。
- 不改 ChatView 其它行为。
