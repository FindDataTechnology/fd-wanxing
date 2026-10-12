# Design: fix-error-turn-billing

## Context

事故链（2026-10-13 实录）：调用方 POST message/send → facade 转发 registry /agent/* → runner child LLM 上游 502 → manager.turn 抛错 → runner 按 A2A 契约回 **HTTP 200 + JSON-RPC error(-32003)** → facade `a2a.js` send 路径 `upstream.ok === true` → 不走 throw → `finish("ok")` → recordUsage billable → settle 扣分钟 + deployer-earnings $0.07。调用方明明收到了错误响应，账本却记成功。chat.js send 路径逐字同款。

两处 stream 路径（a2a.js:442 / chat.js:363）已正确：扫 SSE `event: error` 帧翻 `outcome="error"`；catch 路径（非 2xx `-32033` / 网络错）也正确归 error。**缺陷仅 send 路径的「HTTP ok = 回合 ok」假设**。

core 侧语义现成：`recordUsage` 的 `billable = outcome === "ok"`，error 行落库但豁免（minutes 0、不结算、sweepEarnings 不会为其记账）。

## Goals / Non-Goals

**Goals**：send 路径（双车道）outcome 从响应体派生——JSON-RPC error 对象或不可解析体 ⇒ error ⇒ 豁免；replay/join 零变化；成功回合行为零变化。附历史误计费清点退款。

**Non-Goals**：不动 runner 侧（它已正确回 JSON-RPC error；meter.jsonl 不参与结算决策）；不动 idempotentSend 形状（replay 继续原样回放录得的响应，包括错误响应）；不做按 token 计费或部分退费（分钟级豁免已覆盖事故类）；不追 429/限流类「上游拒绝但回合结构上完成」的细粒度区分（都属 error，豁免——宁可少收不可错收）。

## Decisions

1. **outcome 派生放在 `finish` 调用点，从 `out.response` 读** —— 单点最小改动：
   `const rpcError = out.response?.error; finish(rpcError ? "error" : "ok")`。不改 idempotentSend、不改 exec 的返回形状。
2. **不可解析体也归 error**：exec 里 `doc ?? {…error:{code:-32001}}` 兜底从「空 result 假成功」改为「显式 error」——200+垃圾体同样是失败回合，且调用方本就该看到错误而非空成功。这是行为修正不是回归（旧形状只在 mock 里出现过，真实 runner 永远回合法 JSON-RPC）。
3. **两车道同一改法**（a2a.js / chat.js 对称），回归测试双车道各一条 + replay 一条断言「回放错误回合不再产生新 usage」。
4. **历史清点走账本交叉**：`wanxing_usage` 的 `outcome='ok'` 行 ↔ `wanxing_requests.response` 含 `"error":{"code"` 的交集 = 误计费集合；逐行退款（sub2api admin balance，Idempotency-Key=usage id）+ earnings 行人工对冲（负向 adjust 或删行——按现库形状定，见 tasks）。生产预检先数规模。
5. **不回填改写历史 usage 行**（账本不改账）：退款在 sub2api 侧完成留审计，usage 行保持原样作为事故证据；如需报表口径，后续以 requests 交叉查询为准。

## Risks / Trade-offs

- **收入侧诚实下降**：上游故障期所有失败回合不再计费。这正是目的；对开放前信任面是净收益。
- **上游滥用面**：恶意调用方可故意触发模型错误来免费用计算资源（回合跑了 LLM 重试但豁免）。现状风险敞口小（错误率天然低、RPM/并发闸仍在、LLM 上游成本为主）；真正的「按 token 转嫁」留给 C5/套餐层，不在此片。
- **doc?? 兜底形状变化**：把「空 result」变「error」对旧客户端可见（几乎不存在该形状的真实流量）；A2A 错误响应本就是规范内形状。
