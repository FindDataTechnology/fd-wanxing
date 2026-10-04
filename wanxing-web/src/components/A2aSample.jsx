// The canonical A2A call sample — rendered by both the docs view and the
// intro view from this single source so the two surfaces cannot drift
// (the full one-pager remains docs/wanxing-serving-api.md).
export function A2aSample() {
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-900 text-slate-100 p-4 text-xs">{`curl -X POST "$BASE/api/wanxing/v1/a2a/<agentSlug>" \\
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