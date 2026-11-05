# Proposal: redact-agent-card-private-endpoints (fd-wanxing)

## Why

公网发现面（agent card）正在外发内部运行时地址。生产实证（2026-11-05，从外接 windows-admin 机探测）：`wanxing.finddatatech.cloud` 的几乎全部公开卡片携带 `"provider":{"url":"http://100.64.0.8"}`——tailnet 内网 runner 地址。`publicCard()` 对顶层 `url` 已有"points callers at the facade, never at the internal runtime"纪律，但 `provider: entry.provider ?? …` 把 registry 条目里的 provider 对象原样透传，构成又一处 fail-open 内部面泄漏（与已归档的 registry 内网 mcp_endpoint→桥→plaza 泄漏同模式）。

## What Changes

- `services/wanxing-facade/a2a.js` 的 `publicCard()`：provider 经红敏器序列化——`provider.url` 指向非公网可路由地址（RFC1918、CGNAT 100.64/10、loopback、link-local、单标号服务名、`.svc`/`.cluster.local`/`.local`/`.internal` 后缀）或不可解析时**剔除 `url` 键**（fail-closed）；公网可路由 URL 与 `organization` 等其余字段原样保留；无 provider 时的缺省对象不变。
- 仅动序列化出口（卡片面）；目录面 `/api/wanxing/v1/agents` 本就不含 provider，不动；部署台账/registry 源数据不动。
- `scripts/test-wanxing-facade.mjs` 增卡面测试（内网剔键 / 公网透传 / 不可解析 fail-closed 三态）。

## Capabilities (scope)

- Modified capability: `wanxing-facade` — 公开卡片面新增内部地址红敏要求。
- Out of scope: paas 半边孪生（`paas/gateway/wanxing/a2a.js`）在 paas 仓同名单独立案；registry/快照侧 provider 数据治理（源头修另谈）。
