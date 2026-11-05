#!/usr/bin/env node
// eval-intent-adherence.mjs — 意图信封遵守度的离线评测（change
// harden-copilot-intent-envelope 的任务 1.1）。
//
// 为什么需要它：生产侧没有反馈回路。模型把 question id 写成 nav_usage 时，
// widget 走普通答题分支，答案里没有任何错误信号，模型会以为自己成功了
// （见 proposal 的 Why）。所以措辞改对没有，只能靠离线回放来测——而不是靠
// 人工走查偶然撞见。
//
// 评测上下文刻意与生产同形（design D6）：
//   - 只有 persona + ask_user_question 的工具 schema；
//   - 任何 skill 正文都不进上下文（dsh 的 skill 是渐进披露的，生产里模型
//     不一定读，预载就等于测一个不存在的上下文）；
//   - 不带宿主 context 前缀（它只在首回合作为标记前缀进入）；
//   - 单回合请求。真机的「第二回合」形态由 change 的任务 6.1 探针覆盖。
//
// 用法：
//   node scripts/eval-intent-adherence.mjs --persona <file> [--corpus <file>]
//        [--runs N] [--model <id>] [--base-url <url>] [--api-key <key>]
//        [--providers <file>] [--provider <id>] [--json <out>] [--verbose]
//
// 凭据解析顺序：--api-key / --base-url → 环境变量 INTENT_EVAL_API_KEY /
// INTENT_EVAL_BASE_URL → --providers 指向的 llm-providers.json（缺省
// ~/paas/llm-providers.json，本机便利）。脚本自身不存任何密钥。
//
// 退出码：全部通过 0；有任何一次不通过 1；配置/网络错误 2。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORPUS = join(HERE, "eval-intent-corpus.json");

// ── 工具 schema ─────────────────────────────────────────────────────────────
// 逐字镜像 @deepseek-ai/dsh-tool-ask-user 的模型面（工具级 description、
// questions[].id/question/header/options[].label/description/multi_select）。
// 必须原样保留「stable id」的措辞——它与本协议的信封约定正是冲突的一方，
// 评测要复现的就是这个冲突，不是把它抹掉。
const ASK_TOOL = {
  type: "function",
  function: {
    name: "ask_user_question",
    description:
      "Ask brief, direct, self-contained questions about missing information, preferences, or decisions. Use user-facing terms; assume no knowledge of background work or internal names. Use distinct stable question IDs. A submitted skipped question is an answer item with empty selected and no custom; pending instead means no answer batch arrived before the timeout and the user can still answer.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "Questions to ask the user.",
          items: {
            type: "object",
            additionalProperties: true,
            properties: {
              id: { type: "string", description: "Stable id for this question; echoed in the answer." },
              question: { type: "string", description: "The specific question to ask the user." },
              header: {
                type: "string",
                description: 'Optional short heading for the question, such as "Confirm" or "Choose Mode".',
              },
              options: {
                type: "array",
                description:
                  'Optional choices to show the user. If you recommend one, put it first and append "(Recommended)" to that label.',
                items: {
                  type: "object",
                  additionalProperties: true,
                  properties: {
                    label: { type: "string", description: "Short user-facing option label." },
                    description: { type: "string", description: "One sentence explaining the tradeoff or impact." },
                  },
                  required: ["label"],
                },
              },
              multi_select: {
                type: "boolean",
                description: "Whether the user may select more than one option. Defaults to false.",
              },
            },
            required: ["id", "question"],
          },
        },
      },
      required: ["questions"],
    },
  },
};

// ── 参数 ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    persona: null,
    corpus: DEFAULT_CORPUS,
    runs: 5,
    model: "deepseek-v4.1-flash",
    baseUrl: null,
    apiKey: null,
    providers: null,
    provider: "finddata",
    json: null,
    verbose: false,
    timeoutMs: 90_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const take = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} 需要一个值`);
      i += 1;
      return v;
    };
    switch (a) {
      case "--persona": out.persona = take(); break;
      case "--corpus": out.corpus = take(); break;
      case "--runs": out.runs = Number(take()); break;
      case "--model": out.model = take(); break;
      case "--base-url": out.baseUrl = take(); break;
      case "--api-key": out.apiKey = take(); break;
      case "--providers": out.providers = take(); break;
      case "--provider": out.provider = take(); break;
      case "--json": out.json = take(); break;
      case "--timeout-ms": out.timeoutMs = Number(take()); break;
      case "--verbose": out.verbose = true; break;
      case "-h":
      case "--help": out.help = true; break;
      default: throw new Error(`未知参数 ${a}`);
    }
  }
  if (out.help) return out;
  if (!out.persona) throw new Error("缺少 --persona <file>");
  if (!Number.isInteger(out.runs) || out.runs < 1) throw new Error("--runs 必须是正整数");
  return out;
}

function resolveLane(opts) {
  let baseUrl = opts.baseUrl || process.env.INTENT_EVAL_BASE_URL || "";
  let apiKey = opts.apiKey || process.env.INTENT_EVAL_API_KEY || "";
  if (baseUrl && apiKey) return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, source: "args/env" };

  const file = opts.providers || process.env.INTENT_EVAL_PROVIDERS || join(homedir(), "paas", "llm-providers.json");
  if (!existsSync(file)) {
    throw new Error(
      `凭据未解析：需要 --api-key/--base-url 或环境变量 INTENT_EVAL_API_KEY/INTENT_EVAL_BASE_URL，` +
        `或一个可读的 providers 文件（尝试过 ${file}）`,
    );
  }
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  const p = (cfg.providers || []).find((x) => x.id === opts.provider);
  if (!p) throw new Error(`providers 文件 ${file} 里没有 provider "${opts.provider}"`);
  return { baseUrl: String(p.baseUrl).replace(/\/+$/, ""), apiKey: p.apiKey, source: file };
}

// ── 判定 ────────────────────────────────────────────────────────────────────
const ENVELOPE_RE = /^intent:([a-z][a-z-]{0,31}):(.*)$/;

/** 一次尝试的判定。载荷契约见 spec 的 copilot-intent-adherence 需求 1。 */
function judge(item, toolCall) {
  const args = toolCall ? safeParse(toolCall.function?.arguments) : null;
  const questions = Array.isArray(args?.questions) ? args.questions : [];
  const q0 = questions[0] ?? null;
  const id = typeof q0?.id === "string" ? q0.id : null;
  const options = Array.isArray(q0?.options) ? q0.options : [];
  const labels = options.map((o) => (typeof o?.label === "string" ? o.label : ""));

  const madeIntentAsk = questions.some((q) => typeof q?.id === "string" && ENVELOPE_RE.test(q.id));

  if (item.expectNoAsk) {
    // 对照项：只问「在哪看」不该发意图问询。发普通澄清问、或纯文本回答都算过。
    return {
      pass: !madeIntentAsk,
      idOk: !madeIntentAsk,
      singleOk: questions.length <= 1,
      execFirstOk: true,
      expectedId: null,
      gotId: id,
      questions: questions.length,
      optionLabels: labels,
      note: madeIntentAsk ? "不该发意图问询，却发了" : undefined,
    };
  }

  const idOk = id === item.expectedId;
  const singleOk = questions.length === 1;
  // 承载契约是「第一个选项即执行」；"(Recommended)" 之类的后缀不判失败
  // （proposal 的已知邻接边：只影响文案）。
  const execFirstOk = labels.length === 2 && /执行/.test(labels[0]) && /跳过/.test(labels[1]);
  return {
    pass: idOk && singleOk && execFirstOk,
    idOk,
    singleOk,
    execFirstOk,
    expectedId: item.expectedId,
    gotId: id,
    questions: questions.length,
    optionLabels: labels,
    note: idOk ? undefined : questions.length === 0 ? "没有发出问询" : "id 不是信封",
  };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ── 单次请求 ────────────────────────────────────────────────────────────────
async function askOnce(lane, model, persona, utterance, timeoutMs) {
  const body = {
    model,
    messages: [
      { role: "system", content: persona },
      { role: "user", content: utterance },
    ],
    tools: [ASK_TOOL],
    tool_choice: "auto",
    max_tokens: 1200,
  };
  let lastErr = null;
  // 网关在并发突发下会吐 502 upstream_error。评测是一次性批跑，值得等：
  // 指数退避到 ~30s 上限，共 6 次；非 5xx/429 立刻判死（配置/额度问题）。
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetch(`${lane.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${lane.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // 4xx 是配置/额度问题，重试无意义；5xx/429 退避重试。
        if (res.status < 500 && res.status !== 429) {
          throw Object.assign(new Error(`上游 ${res.status}: ${text.slice(0, 300)}`), { fatal: true });
        }
        lastErr = new Error(`上游 ${res.status}: ${text.slice(0, 200)}`);
      } else {
        const json = await res.json();
        const msg = json?.choices?.[0]?.message ?? {};
        const call = Array.isArray(msg.tool_calls) ? msg.tool_calls.find((c) => c?.function?.name === "ask_user_question") : null;
        return { call: call ?? null, content: msg.content ?? "", finish: json?.choices?.[0]?.finish_reason ?? null };
      }
    } catch (err) {
      if (err.fatal) throw err;
      lastErr = err;
    }
    if (attempt < 5) {
      const waitMs = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr ?? new Error("请求失败");
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 30).join("\n"));
    return 0;
  }

  const lane = resolveLane(opts);
  const persona = readFileSync(opts.persona, "utf8");
  const corpus = JSON.parse(readFileSync(opts.corpus, "utf8"));
  if (!Array.isArray(corpus.items) || corpus.items.length === 0) throw new Error("语料里没有 items");

  console.error(
    `[eval] model=${opts.model} runs=${opts.runs} items=${corpus.items.length} ` +
      `persona=${opts.persona} lane=${lane.baseUrl} (${lane.source})`,
  );

  const results = [];
  for (const item of corpus.items) {
    const attempts = [];
    for (let r = 0; r < opts.runs; r += 1) {
      const { call, content, finish } = await askOnce(lane, opts.model, persona, item.utterance, opts.timeoutMs);
      const verdict = judge(item, call);
      attempts.push({ ...verdict, finish, content: content.slice(0, 400) });
      if (opts.verbose) {
        console.error(
          `  ${item.key} #${r + 1} ${verdict.pass ? "PASS" : "FAIL"} ` +
            `id=${JSON.stringify(verdict.gotId)}${verdict.note ? ` (${verdict.note})` : ""}`,
        );
      }
    }
    const passed = attempts.filter((a) => a.pass).length;
    results.push({ ...item, attempts, passed, total: attempts.length, passRate: passed / attempts.length });
  }

  const total = results.reduce((n, r) => n + r.total, 0);
  const passed = results.reduce((n, r) => n + r.passed, 0);
  const failures = [];
  for (const r of results) {
    for (const [i, a] of r.attempts.entries()) {
      if (!a.pass) {
        failures.push({
          key: r.key,
          utterance: r.utterance,
          run: i + 1,
          expectedId: a.expectedId,
          gotId: a.gotId,
          optionLabels: a.optionLabels,
          questions: a.questions,
          note: a.note,
          content: a.content,
        });
      }
    }
  }

  const report = {
    model: opts.model,
    personaFile: resolve(opts.persona),
    personaSha: sha1(persona),
    corpusFile: resolve(opts.corpus),
    runs: opts.runs,
    temperature: null,
    lane: lane.baseUrl,
    summary: { attempts: total, passed, failed: total - passed, rate: total ? passed / total : 0 },
    perItem: results.map((r) => ({
      key: r.key,
      utterance: r.utterance,
      expectedId: r.expectedId ?? null,
      expectNoAsk: Boolean(r.expectNoAsk),
      passed: r.passed,
      total: r.total,
      passRate: r.passRate,
      gotIds: r.attempts.map((a) => a.gotId),
    })),
    failures,
    results,
  };

  const text = JSON.stringify(report, null, 2);
  if (opts.json) {
    writeFileSync(opts.json, `${text}\n`);
    console.error(`[eval] 报告写入 ${opts.json}`);
  } else {
    console.log(text);
  }

  console.error(`[eval] ${passed}/${total} 通过（${(report.summary.rate * 100).toFixed(1)}%）`);
  if (failures.length) {
    console.error(`[eval] 失败样本 ${failures.length} 条，示例：`);
    for (const f of failures.slice(0, 5)) {
      console.error(`  ${f.key} #${f.run}: expected=${JSON.stringify(f.expectedId)} got=${JSON.stringify(f.gotId)} (${f.note ?? ""})`);
    }
  }
  return failures.length === 0 ? 0 : 1;
}

function sha1(text) {
  // 轻量指纹，只为报告里能区分 persona 变体；不是安全用途。
  let h1 = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h1 ^= text.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return `fnv1a-${h1.toString(16).padStart(8, "0")}`;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[eval] ${err?.message || err}`);
    process.exit(2);
  });
