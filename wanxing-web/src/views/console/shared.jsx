// Console-shared presentation helpers (refactor-console-ia): extracted from
// the former monolith verbatim — one definition, three views.
export const fmtMs = (ms) => (ms == null ? "n/a" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
export const fmtAgo = (ms) => (ms == null ? "?" : ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`);

// A duration a human reads at a glance: minutes under an hour, hours under a
// day, days beyond. Used for "failing for …" — the number that makes an outage
// impossible to mistake for a blip.
export const fmtSpan = (ms) => {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "?";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)} 分钟`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} 小时`;
  return `${Math.round(h / 24)} 天`;
};

// Failure cause as the user should read it. `null` means "no failure" and is
// rendered as nothing; `unknown` means "failed, cause not classified" and says
// so rather than pretending.
export const healthCauseLabel = (k) => {
  if (k == null) return "";
  return ({ cold_start: "冷启动失败", upstream: "上游失败", rate_limited: "被限流", budget: "预算耗尽" })[k] ?? "原因未归类";
};

// Health marker for a deployment card. Renders NOTHING when health is absent
// (the section was unavailable, or the agent is fine) — a missing signal must
// never read as "healthy", and "ok" is the unremarkable case that needs no chip.
export const HealthBadge = ({ health, slug }) => {
  if (!health || !health.health) return null;
  const { health: state, since, lastErrorKind } = health;
  if (state === "failing" || state === "degraded") {
    const failing = state === "failing";
    return (
      <span
        data-testid={`fleet-health-${slug}`}
        title={lastErrorKind ? `最近失败：${healthCauseLabel(lastErrorKind)}` : undefined}
        className={`px-1.5 py-0.5 rounded text-[11px] ${
          failing
            ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
            : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        }`}
      >
        {failing ? "持续失败" : "部分失败"}
        {since != null ? ` · ${fmtSpan(Date.now() - since)}` : ""}
        {lastErrorKind ? ` · ${healthCauseLabel(lastErrorKind)}` : ""}
      </span>
    );
  }
  if (state === "silent") {
    // flag-stalled-rhythm-agents 3.1: zero turns means two different things.
    // A declared rhythm makes silence a finding ("it should have fired M times
    // and fired none"); no declaration keeps the plain "no traffic" wording,
    // because that agent only runs on inbound work.
    const expected = Number(health.expected_turns);
    if (health.stalled === true && Number.isFinite(expected)) {
      const every = Number(health.declared_every_ms);
      const per = Number.isFinite(every) && every > 0 ? (every >= 86_400_000 ? `${Math.round(every / 86_400_000)} 天` : every >= 3_600_000 ? `${Math.round(every / 3_600_000)} 小时` : `${Math.round(every / 60_000)} 分钟`) : "";
      return (
        <span
          data-testid={`fleet-health-${slug}`}
          className="px-1.5 py-0.5 rounded text-[11px] bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
          title={`窗口内零回合，但它声明了节奏：按声明${per ? `每 ${per}` : ""}应有 ${expected} 次`}
        >
          该跑没跑 · 按声明应有 {expected} 次
        </span>
      );
    }
    return (
      <span data-testid={`fleet-health-${slug}`} className="px-1.5 py-0.5 rounded text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-500" title="窗口内零回合：可能刚部署、也可能没人用——不是故障">
        无流量
      </span>
    );
  }
  return null; // ok / paused carry their own existing chips
};

export const channelLabel = (c) => (c === "chat" ? "对话" : c === "api" ? "API" : c ?? "?");

export const sourceBadge = (dim) => {
  const s = dim?.source;
  const label = s === "override" ? "已覆盖" : s === "declared" ? "跟随声明" : "默认";
  const tone = s === "override" ? "bg-accent text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500";
  return <span className={`ml-2 px-1.5 py-0.5 rounded text-[11px] ${tone}`}>{label}</span>;
};

// Plan-request status (add-plan-requests-and-move-statement): one vocabulary
// for the caller's own list (消耗) and the ops queue (运维面).
const PLAN_REQUEST_STATUS = {
  pending: ["待审", "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"],
  approved: ["已批准", "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"],
  rejected: ["已驳回", "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"],
};
export const planRequestBadge = (status) => {
  const [label, tone] = PLAN_REQUEST_STATUS[status] ?? [status ?? "?", "bg-slate-100 dark:bg-slate-800 text-slate-500"];
  return <span className={`px-1.5 py-0.5 rounded font-mono ${tone}`} data-testid="plan-request-status" data-status={status}>{label}</span>;
};
