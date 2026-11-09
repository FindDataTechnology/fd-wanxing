// ── Answerable ask card (unify-cross-line-copilot 5.x) ──────────────────────
//
// ONE card for both shells: the in-site chat view and the embed widget render
// the same questions, options, free-text field, cancel affordance, and deadline
// behaviour, so the same agent never appears to be two different products.
//
// The card owns presentation-local state (selections, custom text, countdown)
// and calls out for everything that needs identity or transport:
//   onSubmit({ answers } | { cancelled: true })
//   onIntentChoice(question, label)   // first option of an intent question
import { useEffect, useRef, useState } from "react";
import { parseIntent } from "../chat-core.js";

export function AskCard({
  ask,                 // { askId, questions: [{ id, question, header?, detail?, options?, multiSelect? }], deadlineAt, busy? }
  onSubmit,
  onIntentChoice,
  hostIntents = [],    // verbs the host page declared; empty = nothing executable
  accent = "#0f172a",
  dark = false,
  testId = "wx-ask",
}) {
  const [sel, setSel] = useState({});
  const [custom, setCustom] = useState({});
  const [left, setLeft] = useState(null);
  const askRef = useRef(ask);
  askRef.current = ask;

  const subtle = dark ? "text-slate-400" : "text-slate-500";

  // Countdown + self-cancel just before the deadline (the runner cancels its
  // own side at the deadline; an early cancel keeps that window race-free).
  useEffect(() => {
    if (!ask) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((ask.deadlineAt - Date.now()) / 1000)));
    tick();
    const iv = setInterval(tick, 1_000);
    const t = setTimeout(() => void onSubmit({ cancelled: true }), Math.max(0, ask.deadlineAt - 5_000 - Date.now()));
    return () => {
      clearInterval(iv);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask?.askId]);

  if (!ask) return null;

  const submit = (payload) => {
    const cur = askRef.current;
    if (!cur || cur.busy) return;
    onSubmit(payload);
  };

  const submitAll = () => {
    const cur = askRef.current;
    if (!cur || cur.busy) return;
    onSubmit({
      answers: cur.questions.map((q, qi) => ({
        id: q.id,
        selected: sel[qi] ?? [],
        custom: (custom[qi] ?? "").trim() || undefined,
      })),
    });
  };

  return (
    <div
      data-testid={testId}
      className={`rounded-lg border p-3 ${dark ? "border-slate-600 bg-slate-800" : "border-slate-200 bg-slate-50"}`}
    >
      <div className="flex items-center gap-2 text-[11px]">
        <span className="font-medium">助手问询</span>
        {left != null && left > 0 && <span className={subtle}>{left}s 后自动取消</span>}
        {ask.busy && <span className={subtle}>宿主执行中…</span>}
        <button type="button" className="ml-auto underline" onClick={() => submit({ cancelled: true })}>取消</button>
      </div>

      {ask.questions.map((q, qi) => {
        const intent = parseIntent(q.id);
        const verbOk = Boolean(intent) && hostIntents.includes(intent.verb);
        const opts = Array.isArray(q.options) ? q.options.filter((o) => o && typeof o.label === "string").slice(0, 8) : [];
        const immediate = ask.questions.length === 1 && !q.multiSelect && opts.length > 0 && !ask.busy;
        const chosen = sel[qi] ?? [];
        return (
          <div key={`${qi}-${q.id}`} className="mt-2 first:mt-1">
            {q.header && <div className="text-[11px] font-medium">{q.header}</div>}
            <div className="whitespace-pre-wrap">{q.question}</div>
            {q.detail && <div className={`whitespace-pre-wrap text-[11px] ${subtle}`}>{q.detail}</div>}
            {intent && (
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                <span className={`rounded border px-1 ${dark ? "border-slate-500" : "border-slate-300"}`}>
                  页面动作 · {intent.verb}{intent.arg ? ` · ${intent.arg}` : ""}
                </span>
                <span className={verbOk ? subtle : "font-medium text-amber-600"}>
                  {verbOk ? "确认后由宿主页面执行" : "当前页面不支持此操作"}
                </span>
              </div>
            )}
            {opts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {opts.map((o, oi) => {
                  const isChosen = chosen.includes(o.label);
                  const primary = Boolean(intent) && oi === 0;
                  return (
                    <button
                      key={o.label}
                      type="button"
                      data-testid={`${testId}-option`}
                      disabled={ask.busy}
                      onClick={() => {
                        if (immediate) {
                          if (intent) onIntentChoice?.(q, o.label);
                          else submit({ answers: [{ id: q.id, selected: [o.label] }] });
                          return;
                        }
                        setSel((prev) => ({
                          ...prev,
                          [qi]: q.multiSelect ? (prev[qi] ?? []).includes(o.label) ? (prev[qi] ?? []).filter((l) => l !== o.label) : [...(prev[qi] ?? []), o.label] : [o.label],
                        }));
                      }}
                      className={`rounded border px-2 py-1 text-xs transition-colors ${
                        isChosen
                          ? dark ? "border-slate-300 bg-slate-700" : "border-slate-400 bg-slate-200"
                          : dark ? "border-slate-600 hover:border-slate-400" : "border-slate-300 hover:border-slate-400"
                      }`}
                      style={primary && !isChosen ? { borderColor: accent, color: accent } : undefined}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              value={custom[qi] ?? ""}
              onChange={(e) => setCustom((prev) => ({ ...prev, [qi]: e.target.value }))}
              placeholder="补充说明（可选，随答案提交）"
              className={`mt-2 w-full rounded border px-2 py-1 text-xs ${dark ? "border-slate-600 bg-slate-900 text-slate-100" : "border-slate-300"}`}
            />
          </div>
        );
      })}

      <button
        type="button"
        disabled={ask.busy}
        onClick={submitAll}
        className="mt-2 rounded px-3 py-1 text-xs text-white disabled:opacity-50"
        style={{ background: accent }}
      >
        提交回答
      </button>
    </div>
  );
}
