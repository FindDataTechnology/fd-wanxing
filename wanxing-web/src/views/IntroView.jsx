// The landing intro: live readouts first, then real agents, then the story.
//
// wanxing-first-impression: the old landing opened with three self-describing
// feature cards and a pricing table while the site's only live numbers sat in
// the footer at 12px — an inverted hierarchy for a product whose identity is a
// machine that is running. Now the first thing a visitor sees is how many
// agents are serving and how much work they did this week, immediately
// followed by cards they can actually click into. Pricing and the about
// statement move below; the caller-facing caliber lives in the docs view.
//
// Live dependency is bounded to one endpoint (the same curated public status
// the footer reads) plus one catalog read for the cards. Both fail to a
// sentence, never to a skeleton, an error banner, or a blank page.
import { useEffect, useState } from "react";
import { A2aSample } from "../components/A2aSample.jsx";
import { usePublicStatus, statusReadouts } from "../components/StatusStrip.jsx";
import { AgentCard } from "./CatalogView.jsx";

const LANDING_CARDS = 6;

function LandingReadouts() {
  const data = usePublicStatus();
  const rows = statusReadouts(data);
  // Not loaded yet renders nothing (no skeleton): the row is decoration until
  // there is something true to put in it.
  if (!rows.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3" data-testid="landing-readouts">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-semibold tabular-nums">{r.value}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function LandingAgents() {
  const [doc, setDoc] = useState(null); // null = loading/not attempted; false = failed
  useEffect(() => {
    let live = true;
    fetch(`/api/wanxing/v1/agents?page_size=${LANDING_CARDS}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) setDoc(d); })
      .catch(() => { if (live) setDoc(false); });
    return () => { live = false; };
  }, []);

  if (doc === false) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="landing-agents-down">
        agent 暂时列不出来——服务本身仍在运行，<a className="underline" href="#/catalog" >稍后到目录看看</a>。
      </p>
    );
  }
  const agents = (doc?.agents ?? []).slice(0, LANDING_CARDS);
  if (!agents.length) return null; // still loading, or genuinely empty: no fake cards
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="landing-agents">
      {agents.map((a) => <AgentCard key={a.slug} agent={a} />)}
    </div>
  );
}

export function IntroView() {
  return (
    <div className="space-y-10 text-sm leading-relaxed">
      <section className="space-y-6 py-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Agent 服务的对外运行与服务平台</h1>
          <p className="text-slate-600 dark:text-slate-400">部署 · 驻留 · 门面 · 计费与机群观测</p>
        </div>
        <LandingReadouts />
        <LandingAgents />
        <div className="flex gap-3">
          <a
            href="#/catalog"
            className="px-4 py-2 rounded-md bg-accent text-white text-sm transition-colors hover:bg-accent-strong"
          >
            浏览全部
          </a>
          <a
            href="#/docs"
            className="px-4 py-2 rounded-md border border-slate-300 text-sm transition-colors hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            对接文档
          </a>
        </div>
      </section>

      {/* The three self-describing feature cards are gone (proposal ①): every
          sentence in them was a claim, while the site holds measured numbers.
          The story that remains is the one a visitor needs — how a call flows
          and what it costs — not an inventory of the product's own virtues. */}

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

      <section>
        <h2 className="font-semibold mb-2">计费口径</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2 px-4 font-medium">项目</th>
                <th className="py-2 px-4 font-medium">口径</th>
              </tr>
            </thead>
            <tbody className="text-slate-600 dark:text-slate-400">
              <tr className="border-b border-slate-100 dark:border-slate-900">
                <td className="py-2 px-4">API 调用（A2A 车道）</td>
                <td className="py-2 px-4">按回合时长计费，分钟向上取整 × 档位单价；回合结束即时结算到你的调用键。</td>
              </tr>
              <tr className="border-b border-slate-100 dark:border-slate-900">
                <td className="py-2 px-4">网页对话（对话/嵌入车道）</td>
                <td className="py-2 px-4">访客免费：平台补贴基线内不计费；超出后用主人池或自带调用键。</td>
              </tr>
              <tr className="border-b border-slate-100 dark:border-slate-900">
                <td className="py-2 px-4">失败回合</td>
                <td className="py-2 px-4">不计费（仍记账，对账可查）。</td>
              </tr>
              <tr>
                <td className="py-2 px-4">具体费率</td>
                <td className="py-2 px-4">费率暂未公开刊列——以计费面板（token.finddatatech.cloud）实际结算为准，或联系运营询价。</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-slate-500">
          費率表的数字随结算面走，不在此页发明；面板里的余额与消费窗是你的财务硬顶。
        </p>
      </section>

      <section>
        <h2 className="font-semibold mb-2">关于萬星</h2>
        <p className="text-slate-600 dark:text-slate-400">
          萬星（Constellation）是寻数（FindData）五条产品线中的智能体服务线：把已经建好的
          Agent 变成对外可调用的服务——部署、驻留、门面、计费与机群观测都由它承担。
          它运行在寻数自有的机群上，与壹座（团队执行平台）、谦面（工作流搭建）、柏讯（数据智能）、
          识律（法律智能）互通：任何一条线上的 agent 都可以经萬星对外服务。
        </p>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          运营方：寻数科技（FindData）。问题与合作：见页脚联系方式。
        </p>
      </section>
    </div>
  );
}
