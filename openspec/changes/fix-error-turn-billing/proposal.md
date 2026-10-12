# Proposal: fix-error-turn-billing

## Why

F3.3 验收挂账缺陷②，2026-10-13 在 add-serving-runner-split 切换日升级为**真实计费事故**：openrouter 上游大面故障期间，两次模型失败回合（LLM 502，调用方收到 -32003 错误、零内容）被记 `outcome:"ok"`、照常按分钟扣费并给部署者分成 $0.07/回合——已手工退演练号 $0.20。开放前置（M4⑤ 合规项）的硬前提：外部付费流量进来之前，失败回合绝不能计费。

## What Changes

病灶两处同款（API 车道 a2a.js:473、chat 车道 chat.js:391）：`message/send` 路径只看上游 HTTP 状态，**而 A2A 传输契约是 JSON-RPC error 随 HTTP 200 返回**（runner 对模型失败回合回 200+`{error:{code:-32003,…}}`）→ 上游 ok → 无条件 `finish("ok")` → 计费+分成。stream 路径早已正确（扫 `event: error` 帧）。

修复：send 路径的 outcome 从**响应体**派生——JSON-RPC error 对象或不可解析响应 ⇒ `finish("error")`（既有语义：记录但豁免，不结算不分成）。replay/join 路径零变化（不记 usage）。catch 兜底路径（非 2xx/网络错）零变化。

连带：历史伤害清点——生产库里 `outcome:"ok"` 但账本 response 含 JSON-RPC error 的回合，退款+复权；F3.3 案例卡挂账②翻案。

## Capability

`wanxing-facade`（MODIFY「Admitted turns are metered and settled at the boundary」——补 outcome 派生契约）。

## Impact

- 代码：a2a.js/chat.js 各一行级派生改动；无 schema、无接口形状变化（调用方收到的响应不变，只是账本不再把失败回合计成 ok）。
- 部署：fd-wanxing 出片 → wanxing-facade 滚一版。
- 生产影响面：上游故障期的失败回合从计费变豁免（收入侧诚实下降，信任侧上升）；正常成功回合零变化。
