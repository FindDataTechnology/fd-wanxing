// ── One turn forward with OUR deadline, not the library's ───────────────────
//
// A `message/send` turn answers only AFTER the model turn finishes, so the
// forward is a LONG call (production: 2–5 minutes per ticket). Node's global
// `fetch` inherits undici's `headersTimeout` default of 300 s, which fires as
// a bare `TypeError: fetch failed` — indistinguishable from a refused
// connection — and the turn path then records it as -32032 ("generic"), not
// -32041 ("timed out"). Measured live 2026-11-14: six consecutive turns
// landed at 300 s / 301 s / 301 s / 300 s / 284 s and every one was reported
// as -32032, while the same registry hop answered a cheap request in 262 ms —
// i.e. the transport was healthy and WE were the ones giving up.
//
// Raising `fetch`'s ceiling is not possible without the `undici` package (not
// a dependency of this service, so it would only work on machines that happen
// to have it on the resolution path — exactly the "green locally, dead in the
// image" class of failure). So the long path gets its own transport: plain
// `node:http`/`node:https` with one explicit total deadline, which lets the
// caller choose a budget that actually covers a turn and maps the expiry to
// the structured -32041 instead of a generic transport error.
//
// Contract mirrors the subset of `fetch` the turn path uses (ok/status/headers
// get/text/json), so the injected `upstreamFetch` test seam keeps working: the
// tests keep supplying their own `Response`, production takes this path.
//
// "Mirrors fetch" includes the PART THAT IS EASY TO GET WRONG: `text()` and
// `json()` return Promises. The turn path reads its answer as
// `await upstream.json().catch(() => null)` — straight fetch idiom — so a
// synchronous `json()` makes that call a TypeError on **every turn that gets
// far enough to have a body**, i.e. on exactly the successful ones. Measured
// live 2026-11-16: four spider-heal tickets came back as
// `{"code":-32032,"message":"upstream.json(...).catch is not a function"}`
// while the same route answered 200, and the retry budget burned out on the
// TypeError rather than on anything upstream did. The unit tests could not see
// it: they inject `upstreamFetch` (a real `Response`, Promise-returning) and
// asserted `r.json().result` — the seam asserted the shape the caller never
// uses. `r.json()` yields `null` on unparseable text instead of rejecting, so
// the caller's `.catch(() => null)` and its `?? unreadable-response` fallback
// keep their existing meaning.
import http from "node:http";
import https from "node:https";

/**
 * POST a JSON body and read the whole response, under one total deadline.
 *
 * @param {string} url
 * @param {Record<string,string>} headers
 * @param {string} body
 * @param {number} timeoutMs total budget for connect + headers + body
 * @returns {Promise<{ok:boolean,status:number,headers:{get(n:string):string|null},text():Promise<string>,json():Promise<any>}>}
 */
export function postJsonWithDeadline(url, headers, body, timeoutMs) {
  const budget = Number(timeoutMs);
  if (!Number.isFinite(budget) || budget <= 0) {
    return Promise.reject(new Error(`postJsonWithDeadline needs a positive timeoutMs (got ${timeoutMs})`));
  }
  const target = new URL(url);
  const isHttps = target.protocol === "https:";
  const mod = isHttps ? https : http;
  const payload = Buffer.from(body ?? "", "utf8");

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    // The timeout is a DOMException-shaped TimeoutError on purpose: the turn
    // path already maps `name === "TimeoutError" || "AbortError"` to -32041,
    // so the budget expiry arrives as "timed out", never as a transport fault.
    const timer = setTimeout(() => {
      const err = new Error(`turn forward exceeded ${Math.round(budget / 1000)}s`);
      err.name = "TimeoutError";
      finish(err);
      req.destroy();
    }, budget);

    const req = mod.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": payload.length },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          finish(null, {
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: { get: (n) => (res.headers[String(n).toLowerCase()] ?? null) },
            // Promise-returning, like fetch — the caller does
            // `await upstream.json().catch(() => null)`, and a bare value here
            // turns every successful turn into a TypeError (see the header).
            text: () => Promise.resolve(text),
            json: () =>
              Promise.resolve().then(() => {
                try {
                  return JSON.parse(text);
                } catch {
                  return null;
                }
              }),
          });
        });
        res.on("error", (e) => finish(e));
      },
    );
    req.on("error", (e) => finish(e));
    req.end(payload);
  });
}
