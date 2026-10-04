// The integration one-pager, in-site (docs/wanxing-serving-api.md is the
// source of truth; this page carries the caller essentials).
import { A2aSample } from "../components/A2aSample.jsx";

const ERRORS = [
  ["401", "INVALID_KEY / UNRESOLVED_KEY", "键形状错 / 键无法解析到账号"],
  ["402", "INSUFFICIENT_BALANCE", "键余额或消费窗不足"],
  ["402", "CALLER_SUSPENDED", "结算连续失败被挂起；充值后自动解除"],
  ["403", "CALLER_NOT_AUTHORIZED", "私有 agent 且不在允许清单"],
  ["404", "AGENT_NOT_FOUND", "无此部署条目"],
  ["409", "TURN_IN_FLIGHT", "该（调用者,agent）已有回合在跑；按 Retry-After 重试"],
  ["423", "AGENT_PAUSED", "agent 已暂停（显式状态，非超时）"],
  ["429", "RATE_LIMITED", "超过调用者 RPM"],
  ["503", "WANXING_BILLING_UNAVAILABLE", "平台计费面未配置（fail-closed）"],
];

export function DocsView() {
  return (
    <div className="space-y-8 text-sm leading-relaxed">
      <section>
        <h1 className="text-xl font-semibold mb-2">对接一页纸</h1>
        <p className="text-slate-600 dark:text-slate-400">
          以外部账号调用萬星 Agent 服务：A2A 原生（JSON-RPC 2.0 over HTTP），
          <code className="mx-1 px-1 rounded bg-slate-100 dark:bg-slate-800">message/send</code>同步 /
          <code className="mx-1 px-1 rounded bg-slate-100 dark:bg-slate-800">message/stream</code>SSE。
          鉴权用你在计费面板自铸的调用键（Bearer），按时长计费、分钟向上取整。
        </p>
      </section>

      <section>
        <h2 className="font-semibold mb-2">调用示例</h2>
        <A2aSample />
        <p className="mt-2 text-slate-500">
          <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">agentSlug</code> 取自
          <a className="underline" href="#/catalog">目录</a>；同步返回的是回执（如 queued），
          查询状态=再发一条 <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">STATUS my-ticket-001</code>。
        </p>
      </section>

      <section>
        <h2 className="font-semibold mb-2">幂等与并发</h2>
        <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
          <li><b>Idempotency-Key</b>（仅 message/send）：24h 重放窗内同键重放返回首次完整应答，不跑第二个回合、不产生第二条计费。</li>
          <li>每（调用者, agent）并发回合 = 1：超发返回 409 + <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">Retry-After</code>。</li>
          <li>失败回合（平台侧/上游错误）不计费，但会记账。</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold mb-2">错误码</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left border-b border-slate-300 dark:border-slate-700">
                <th className="py-2 pr-4">HTTP</th><th className="pr-4">code</th><th>含义</th>
              </tr>
            </thead>
            <tbody>
              {ERRORS.map(([http, code, msg]) => (
                <tr key={code} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-1.5 pr-4 font-mono">{http}</td>
                  <td className="pr-4 font-mono">{code}</td>
                  <td className="text-slate-600 dark:text-slate-400">{msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
