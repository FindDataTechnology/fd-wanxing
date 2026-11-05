// The canonical A2A call sample — rendered by both the docs view and the
// intro view from this single source so the two surfaces cannot drift
// (the full one-pager remains docs/wanxing-serving-api.md).
// $BASE is a REAL value (wanxing-first-visitor 2.1): every sample must be
// copy-paste runnable against production, so the base URL is baked in and
// exported once for any other surface that needs it.
export const WANXING_BASE = "https://wanxing.finddatatech.cloud";

export function A2aSample() {
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-900 text-slate-100 p-4 text-xs">{`curl -X POST "${WANXING_BASE}/api/wanxing/v1/a2a/<agentSlug>" \\
  -H "Authorization: Bearer sk-xxxx" \\
  -H "Idempotency-Key: my-ticket-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0", "id": 1,
    "method": "message/send",
    "params": { "message": {
      "role": "user",
      "parts": [{ "kind": "text", "text": "SUBMIT my-task-001" }]
    }}
  }'`}</pre>
  );
}
// The cluster call sample (add-cluster-service-unit): one message/send fans
// out to the unit's served members; member selection and aggregation ride
// message.metadata. Billing is per member turn — the summary aggregation
// adds one more (the lead's synthesis turn).
export function ClusterA2aSample() {
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-900 text-slate-100 p-4 text-xs">{`curl -X POST "${WANXING_BASE}/api/wanxing/v1/a2a/cluster/<clusterSlug>" \\
  -H "Authorization: Bearer sk-xxxx" \\
  -H "Idempotency-Key: my-ticket-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0", "id": 1,
    "method": "message/send",
    "params": { "message": {
      "role": "user",
      "parts": [{ "kind": "text", "text": "从三个镜头审读这家公司" }],
      "metadata": {
        "agents": ["macro-analyst", "valuation-analyst"],
        "aggregation": "summary"
      }
    }}
  }'`}</pre>
  );
}
