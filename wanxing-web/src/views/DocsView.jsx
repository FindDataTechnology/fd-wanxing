// The integration one-pager, in-site (docs/wanxing-serving-api.md is the
// source of truth; this page carries the caller essentials).
import { A2aSample, ClusterA2aSample, WANXING_BASE } from "../components/A2aSample.jsx";

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
  ["404", "CLUSTER_NOT_FOUND", "无此集群单位（须至少一个默认成员在役）"],
  ["403", "CLUSTER_NOT_ADMITTED", "所选集群成员无一获准（附各成员原因）"],
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
        <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs">
          <span className="font-semibold">服务地址</span>：<code className="font-mono">{WANXING_BASE}</code>
          （下述示例已写实该地址，可直接复制执行）。完整一页纸见仓库 <code className="font-mono">docs/wanxing-serving-api.md</code>。
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-2">三行快速开始</h2>
        <ol className="list-decimal pl-5 space-y-1 text-slate-600 dark:text-slate-400">
          <li>在 <a className="underline" href="https://token.finddatatech.cloud" target="_blank" rel="noreferrer">token.finddatatech.cloud</a> 自铸一个调用键（sk-…）。</li>
          <li>在<a className="underline" href="#/catalog">目录</a>挑一个 agent，复制其 slug（卡片上可直接复制）。</li>
          <li>用下方示例发第一条 <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">message/send</code>——收到的就是回执。</li>
        </ol>
      </section>

      <section>
        <h2 className="font-semibold mb-2">发现端点与调用者偏好</h2>
        <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
          <li><b>AgentCard 发现</b>（A2A 标准）：<code className="px-1 rounded bg-slate-100 dark:bg-slate-800">GET {WANXING_BASE}/api/wanxing/v1/a2a/&lt;agentSlug&gt;/.well-known/agent-card.json</code>——无需鉴权，返回名称/技能/能力声明。</li>
          <li><b>调用者偏好</b>（收割窗与回调签名）：<code className="px-1 rounded bg-slate-100 dark:bg-slate-800">GET/PUT {WANXING_BASE}/api/wanxing/v1/prefs/&lt;agentSlug&gt;</code>（Bearer 调用键）——读取/设置你对该 agent 的回合收割窗与回调配置；不设置则走平台默认。</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold mb-2">嵌入车道 · 一行接入</h2>
        <p className="text-slate-600 dark:text-slate-400">
          产品线页面挂一个脚本标签即可，<b>宿主不写任何 postMessage 协议</b>：
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-[11px] leading-relaxed">{`<script src="${WANXING_BASE}/copilot.js" data-line="lex" async></script>`}</pre>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          loader 自己解析<b>这条线绑定的副驾</b>、注入 widget、跑完整宿主协议。可选钩子只有三个：
          <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">WanxingCopilot.identify()</code>（每回合的宿主身份）、
          <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">.context()</code>（页面上下文）、
          <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">.intents</code>（页面动作白名单）；
          不提供任何一个也能工作——只是访客会落到 widget 自己的梯队（匿名或登录升级）。
        </p>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          该线未绑定副驾、助手已暂停、或没有任何访客梯队可服务时，loader <b>不注入任何东西</b>，只在 console 记一条原因——
          静默死卡比没有入口更糟。
          <a className="underline" href="/host-demo.html" target="_blank" rel="noreferrer">宿主示例页</a>
          是可运行的完整参考（<code className="px-1 rounded bg-slate-100 dark:bg-slate-800">?line=&lt;线id&gt;</code> 可换线试）。
        </p>
        <p className="mt-2 text-slate-500">
          直连 <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">{WANXING_BASE}/#/embed/&lt;agentSlug&gt;</code>
          仍然可用（就是 loader 注入的那个 iframe，行为一致），但宿主需自己实现协议；loader 不可用时才走这条路。
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

      <section id="cluster-calls">
        <h2 className="font-semibold mb-2">集群调用</h2>
        <p className="mb-2 text-slate-600 dark:text-slate-400">
          声明了 <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">cluster</code> 的 pack
          且至少一个默认成员在役时，整个小队是一个 A2A 服务单位：路由
          <code className="mx-1 px-1 rounded bg-slate-100 dark:bg-slate-800">/a2a/cluster/&lt;clusterSlug&gt;</code>
          （clusterSlug 见<a className="underline" href="#/catalog">目录</a>的集群组头），仅支持
          <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">message/send</code>。
        </p>
        <ClusterA2aSample />
        <ul className="mt-2 list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
          <li><b>成员选择</b>：<code className="px-1 rounded bg-slate-100 dark:bg-slate-800">metadata.agents</code>（可选项或在役成员子集；缺省 = 全部在役默认成员）。</li>
          <li><b>聚合</b>：<code className="px-1 rounded bg-slate-100 dark:bg-slate-800">metadata.aggregation</code> = <code>all</code>（缺省，各成员各一节）/ <code>first</code>（最先成功者）/ <code>summary</code>（声明序首个成功默认成员多跑一回合综合）。</li>
          <li><b>计费</b>：每个成员回合按直调口径逐个计费（失败/跳过成员免计）；<code>summary</code> 额外多一个回合。集群单位本身不另计费。</li>
          <li>应答的 <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">metadata.cluster</code> 携各成员状态（ok / error / skipped 及原因、分钟数、summaryBy）。</li>
        </ul>
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
