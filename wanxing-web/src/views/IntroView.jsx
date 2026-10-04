// The landing intro: static and Chinese-first. Value hero on top, then the
// caller quick facts (the A2A sample shared with the docs view). No live
// data — catalog and fleet state belong to the catalog and console views.
import { A2aSample } from "../components/A2aSample.jsx";

const FEATURES = [
  {
    title: "服务目录",
    body: "浏览已上线的公开 Agent 服务：名称、说明、版本与标签，分页加载、页内检索。",
  },
  {
    title: "A2A 调用",
    body: "原生 A2A（JSON-RPC 2.0 over HTTP）端点，Bearer 调用键鉴权；幂等键重放窗内不双跑、不双计。",
  },
  {
    title: "计量与计费",
    body: "按时长计费、分钟向上取整，回合结束即时结算；失败回合不计费（仍记账），余额不足即拒付。",
  },
];

export function IntroView() {
  return (
    <div className="space-y-10 text-sm leading-relaxed">
      <section className="py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Agent 服务的对外运行与服务平台</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400">部署 · 驻留 · 门面 · 计费与机群观测</p>
        <div className="mt-6 flex gap-3">
          <a
            href="#/catalog"
            className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            浏览目录
          </a>
          <a
            href="#/docs"
            className="px-4 py-2 rounded-md border border-slate-300 text-sm transition-colors hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            对接文档
          </a>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
            <h2 className="font-semibold mb-1.5">{f.title}</h2>
            <p className="text-slate-600 dark:text-slate-400">{f.body}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="font-semibold mb-2">工作原理</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 p-4 text-xs font-mono text-slate-600 dark:text-slate-400">
          <p>调用方 → 萬星门面（A2A API + 幂等键）→ runner → agent 回合</p>
          <p className="mt-1">门面侧计量记账，按调用者账户结算</p>
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-2">开始调用</h2>
        <A2aSample />
        <p className="mt-2 text-slate-500">
          <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">agentSlug</code> 取自
          <a className="underline" href="#/catalog">目录</a>；鉴权、幂等与错误码的完整说明见
          <a className="underline" href="#/docs">对接文档</a>。
        </p>
      </section>
    </div>
  );
}