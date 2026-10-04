// Three hash-routed views (catalog / docs / console) — deliberately no router
// dependency: the face is three pages, not an app tree.
import { useEffect, useState } from "react";
import { CatalogView } from "./views/CatalogView.jsx";
import { DocsView } from "./views/DocsView.jsx";
import { ConsoleView } from "./views/ConsoleView.jsx";

const VIEWS = { "#/": CatalogView, "#/docs": DocsView, "#/console": ConsoleView };

export function App() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const View = VIEWS[hash] ?? CatalogView;
  const tab = (h, label) => (
    <a
      href={h}
      className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
        (hash === h || (h === "#/" && !VIEWS[hash]))
          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
          : "hover:bg-slate-200 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </a>
  );
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <a href="#/" className="text-lg font-semibold tracking-wide">萬星</a>
          <span className="text-sm text-slate-500">Agent 服务目录与运营台</span>
          <nav className="ml-auto flex gap-1">
            {tab("#/", "目录")}
            {tab("#/docs", "文档")}
            {tab("#/console", "控制台")}
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <View />
      </main>
      <footer className="max-w-5xl mx-auto px-4 py-8 text-xs text-slate-400">
        萬星 Wanxing · 寻数 constellation 线 · <a className="underline" href="https://finddatatech.cloud">寻数科技</a>
      </footer>
    </div>
  );
}
