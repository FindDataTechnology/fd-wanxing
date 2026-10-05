// Four hash-routed views (intro / catalog / docs / console) — deliberately no
// router dependency: the face is four pages, not an app tree. The intro is
// the default landing (`#/`); the catalog lives at `#/catalog`.
// 页脚分域（add-console-session-continuity，grill Q1=1b）：三个内容视图渲染
// 家族页脚（品牌区 + 联系 + 五线阶梯 + 入口 + 使命句 + 两条备案，见
// upgrade-wanxing-footer）；控制台是工具面，只渲染一行合规条（© + 双备案）。
// 导航随登录态切换（Q2=3a/Q11）：未登录 =「登录」直发 PKCE；已登录 =
// 「控制台」+ 邮箱·退出 chip。联系与备案是事实常量，站点无 i18n。
import { useEffect, useState } from "react";
import { IntroView } from "./views/IntroView.jsx";
import { CatalogView } from "./views/CatalogView.jsx";
import { DocsView } from "./views/DocsView.jsx";
import { ConsoleView } from "./views/ConsoleView.jsx";
import { LineLadder } from "./components/LineLadder.jsx";
import { SiteMark } from "./components/SiteMark.jsx";
import { loginLogto, signOut, useAuth } from "./auth.js";

const VIEWS = { "#/": IntroView, "#/catalog": CatalogView, "#/docs": DocsView, "#/console": ConsoleView };

const CONTACT_EMAIL = "1253774197@qq.com";
const CONTACT_PHONE = "17753221425";
const CONTACT_PHONE_TEL = "tel:+8617753221425";
const ICP_FILING = { label: "粤ICP备2026118740号-1", href: "https://beian.miit.gov.cn/" };
const MPS_FILING = {
  label: "粤公网安备44030002016558号",
  href: "https://beian.mps.gov.cn/#/query/webSearch?code=44030002016558",
};
const LINE_PAGE = "https://www.finddatatech.cloud/zh/products/constellation/";
const ENTRIES = [
  { label: "介绍", href: "#/" },
  { label: "目录", href: "#/catalog" },
  { label: "文档", href: "#/docs" },
  { label: "控制台", href: "#/console" },
];

const linkCls = "text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100";

function ComplianceLine() {
  return (
    <footer data-testid="wanxing-compliance-line" className="border-t border-slate-200 dark:border-slate-800">
      <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
        <span>© 2026 寻数（FindData）· 萬星 Constellation</span>
        <a className="hover:text-slate-900 dark:hover:text-slate-100" href={ICP_FILING.href} target="_blank" rel="noopener noreferrer">
          {ICP_FILING.label}
        </a>
        <a className="hover:text-slate-900 dark:hover:text-slate-100" href={MPS_FILING.href} target="_blank" rel="noopener noreferrer">
          {MPS_FILING.label}
        </a>
      </div>
    </footer>
  );
}

function FamilyFooter() {
  return (
    <footer data-testid="wanxing-footer" className="border-t border-slate-200 dark:border-slate-800">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <div className="flex items-center gap-2.5">
              <SiteMark chars="萬星" size="lg" />
              <span className="text-base font-semibold">萬星</span>
            </div>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              Agent 服务的对外运行与服务平台
            </p>
            <h3 className="mt-6 text-xs font-medium text-slate-500 dark:text-slate-400">联系</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              <a className="hover:text-slate-900 dark:hover:text-slate-100" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              <span className="mx-1.5">·</span>
              <a className="hover:text-slate-900 dark:hover:text-slate-100" href={CONTACT_PHONE_TEL}>
                {CONTACT_PHONE}
              </a>
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400">寻数产品线</h3>
            <div className="mt-2.5">
              <LineLadder />
            </div>
          </div>
          <div>
            <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400">入口</h3>
            <ul className="mt-2.5 space-y-1.5 text-sm">
              {ENTRIES.map((e) => (
                <li key={e.href}>
                  <a className={linkCls} href={e.href}>
                    {e.label}
                  </a>
                </li>
              ))}
              <li>
                <a className={linkCls} href={LINE_PAGE} target="_blank" rel="noopener noreferrer">
                  萬星线页
                </a>
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-8 text-sm text-slate-600 dark:text-slate-400">
          寻数科技聚焦AI时代下的文本和数据处理的基础设施建设，致力于推动信息平权，最终促进社会公平。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span>© 2026 寻数（FindData）· 萬星 Constellation</span>
          <a className="hover:text-slate-900 dark:hover:text-slate-100" href={ICP_FILING.href} target="_blank" rel="noopener noreferrer">
            {ICP_FILING.label}
          </a>
          <a className="hover:text-slate-900 dark:hover:text-slate-100" href={MPS_FILING.href} target="_blank" rel="noopener noreferrer">
            {MPS_FILING.label}
          </a>
        </div>
      </div>
    </footer>
  );
}

export function App() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  const auth = useAuth();
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const View = VIEWS[hash] ?? IntroView;
  const tab = (h, label) => (
    <a
      href={h}
      className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
        (VIEWS[hash] ? hash === h : h === "#/")
          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
          : "hover:bg-slate-200 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </a>
  );
  const onLogin = () => loginLogto().catch((e) => alert(String(e?.message || e)));
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href="#/" className="flex items-center gap-2.5 text-lg font-semibold tracking-wide">
            <SiteMark chars="萬" size="md" />
            萬星
          </a>
          <span className="text-sm text-slate-500">Agent 服务目录与运营台</span>
          <nav className="ml-auto flex gap-1 items-center">
            {tab("#/", "介绍")}
            {tab("#/catalog", "目录")}
            {tab("#/docs", "文档")}
            {auth.token ? (
              tab("#/console", "控制台")
            ) : (
              <button
                onClick={onLogin}
                className="px-3 py-1.5 rounded-md text-sm transition-colors hover:bg-slate-200 dark:hover:bg-slate-800"
              >
                登录
              </button>
            )}
            {auth.token && (
              <span className="ml-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                {auth.email && <span className="hidden sm:inline">{auth.email}</span>}
                <button
                  onClick={() => void signOut()}
                  className="underline hover:text-slate-900 dark:hover:text-slate-100"
                >
                  退出
                </button>
              </span>
            )}
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 w-full flex-1">
        <View />
      </main>
      {hash === "#/console" ? <ComplianceLine /> : <FamilyFooter />}
    </div>
  );
}
