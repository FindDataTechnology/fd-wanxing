// 跨面状态事实（unify-wanxing-surface-language D1/D2）
//
// 萬星对「一个 agent 现在是什么状态」有三套说法，说的是同一组事实：
//   · 门面 statusFor()（services/wanxing-facade/core.js:46）发 paused|unknown|serving|idle，
//     其中 serving 的真意是「近 7 天有人调用」、idle 是「近 7 天零调用」——不是进程在跑/待命；
//   · 观测面 health 用 ok|silent|paused|degraded|failing（外加 stalled）；
//   · 控制台舰队卡只读 paused，自造「运行中/已暂停」，无视前两者。
//
// 后果是同屏自相矛盾：health=failing 的 agent 戴着绿色「运行中」和红色「持续失败」两枚徽标。
//
// 本模块是唯一的事实表：七种事实、一条优先级链、每个 agent 只出一枚主徽标。
// 纯函数、零依赖——四个消费面（目录/详情/舰队卡/运维板）都只调用这里。

/** 七种事实，键即优先级顺序（数组顺序就是 D1 的链）。 */
export const FACT_ORDER = ["paused", "unknown", "failing", "degraded", "stalled", "unused", "live"];

const UI = {
  paused: { label: "已暂停", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  unknown: { label: "状态未知", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
  failing: { label: "持续失败", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  degraded: { label: "部分失败", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  stalled: { label: "该跑没跑", cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" },
  unused: { label: "尚无调用", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  live: { label: "在役", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
};

/**
 * 判定一个 agent 的主事实。
 *
 * @param {object}   input
 * @param {string}   input.status          门面 status：serving|idle|paused|unknown
 * @param {object}   [input.health]        观测面 health 条目 {health, stalled, ...}
 * @param {boolean}  [input.healthSectionUp] 观测面这一段是否可用：
 *   段可用但本 agent 缺席 -> 状态未知（D1 第 2 条）；
 *   整段不可用 -> 不冒充未知，回落到 status 的事实（舰队卡今天的「不渲染健康徽标」）。
 * @returns {string} FACT_ORDER 之一
 */
export function factOf({ status, health, healthSectionUp = false } = {}) {
  const h = health?.health ?? null;

  // 1 已暂停：管理员动作压过一切，包括故障——读者不该去排一个故意停下的东西。
  if (status === "paused" || h === "paused") return "paused";

  // 2 状态未知：数据不可信时既不报健康也不报故障。
  if (status === "unknown" || (healthSectionUp && !h)) return "unknown";

  // 3/4 故障在「该跑没跑」之上：有调用且失败，比没有调用更急。
  if (h === "failing") return "failing";
  if (h === "degraded") return "degraded";

  // 5 该跑没跑：零回合，但声明了节奏——与「没人用」是两件事。
  if (h === "silent" && health.stalled === true) return "stalled";

  // 6 在役（台账优先）：facade 的 serving 是「近 7 天有人在调」，读数来自计费
  //    台账；健康面的 silent 是观测采样得出的推断。两者冲突时硬数字赢——否则
  //    同一张舰队卡会出现「徽标：尚无调用 / 下一行：近 7 天回合 9」的自相矛盾
  //    （2026-11-22 实撞，「寻数分身」那张卡）。silent 只在台账也说零时才说话。
  if (status === "serving" || h === "ok") return "live";

  // 7 尚无调用：零调用且无节奏声明。注意这是 status=idle 的真意。
  if (status === "idle" || h === "silent") return "unused";

  // 什么证据都没有：只能是未知。
  return "unknown";
}

/** 事实 -> 徽标。label/cls 是唯一的展示真源；title 是排障可读的原值。 */
export function badgeFor(fact) {
  const ui = UI[fact] ?? UI.unknown;
  return { fact: UI[fact] ? fact : "unknown", label: ui.label, cls: ui.cls };
}

/** 事实的中文名（运维板的枚举行复用）。 */
export function factLabel(fact) {
  return (UI[fact] ?? UI.unknown).label;
}

/** 只有「在役」算健康。别处需要「能不能宣传成好的」时用这个，不要自己比字符串。 */
export function isHealthy(fact) {
  return fact === "live";
}
