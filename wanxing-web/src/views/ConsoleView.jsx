// Deployer console shell (refactor-console-ia, M4④ 前置): the auth gate and
// a three-tab skeleton — 我的舰队 / 我的任务 / 运维面. Every panel's behavior
// moved verbatim into views/console/*; this shell only routes. The deep-link
// contract keeps `#/console/<slug>` opening that deployment's config panel
// (fleet tab), and reserves `#/console/missions` / `#/console/ops` as tab
// routes (deployment slugs carry the packs- prefix — no collision).
import { useEffect, useState } from "react";
import { loginLogto, setOpsToken, useAuth } from "../auth.js";
import { FleetView } from "./console/FleetView.jsx";
import { MissionsView } from "./console/MissionsView.jsx";
import { OpsView } from "./console/OpsView.jsx";
import { DevicesView } from "./console/DevicesView.jsx";
import { StatsView } from "./console/StatsView.jsx";

const TABS = [
  ["fleet", "我的舰队"],
  ["missions", "我的任务"],
  ["devices", "桌面机位"],
  ["stats", "消耗"],
  ["ops", "运维面"],
];

export function ConsoleView({ focusSlug } = {}) {
  const auth = useAuth();
  const token = auth.token;
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState("fleet");

  // Reserved sub-routes switch tabs; anything else is a deployment slug deep
  // link — the fleet tab opens with that slug's config panel.
  useEffect(() => {
    if (focusSlug === "missions" || focusSlug === "ops" || focusSlug === "devices" || focusSlug === "stats") setTab(focusSlug);
    else if (focusSlug) setTab("fleet");
  }, [focusSlug]);

  if (!token) {
    return (
      <div className="max-w-sm mx-auto mt-16 space-y-4">
        <h1 className="text-xl font-semibold">部署者控制台</h1>
        {auth.notice && (
          <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm">
            {auth.notice}
          </div>
        )}
        <button
          onClick={() => loginLogto().catch((e) => alert(String(e?.message || e)))}
          className="w-full px-3 py-2.5 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm"
        >
          使用寻数账号登录（Logto）
        </button>
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer select-none">运维通道：服务凭据</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setOpsToken(draft);
              setDraft("");
            }}
            className="space-y-3 pt-2"
          >
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="service token"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
            <button className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm">进入</button>
          </form>
        </details>
      </div>
    );
  }

  const fleetSlug = tab === "fleet" && focusSlug && focusSlug !== "missions" && focusSlug !== "ops" && focusSlug !== "devices" && focusSlug !== "stats" ? focusSlug : null;

  return (
    <div className="space-y-5" data-testid="console-shell">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">部署者控制台</h1>
        <div className="flex gap-1 ml-2" data-testid="console-tabs">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                tab === key
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-transparent"
                  : "border-slate-300 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              }`}
              data-testid={`console-tab-${key}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "fleet" && <FleetView focusSlug={fleetSlug} />}
      {tab === "missions" && <MissionsView />}
      {tab === "stats" && <StatsView />}
      {tab === "devices" && <DevicesView />}
      {tab === "ops" && <OpsView />}
    </div>
  );
}
