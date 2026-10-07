// ── Caller preferences face (add-caller-preferences) ────────────────────────
//
// The caller-facing preference surface: the same sub2api caller key that
// opens the A2A door authenticates here (core.authenticate — one billing
// gate, never a second rule). Writes cover the turn-completion callback
// (URL + HMAC secret) and the external-context reap window; the SECRET is
// never echoed back (the response reports presence, not value).
//
//   GET  /api/wanxing/v1/prefs/:slug   → { prefs: { callbackUrl, callbackSecretSet, reapMinutes } }
//   PUT  /api/wanxing/v1/prefs/:slug   → body { callbackUrl?, callbackSecret?, reapMinutes? }
//                                        (undefined = keep, null = clear that dimension)

import express from "express";

export const PREFS_REAP_MIN_MINUTES = 1;
export const PREFS_REAP_MAX_MINUTES = 10_080; // one week
export const PREFS_CALLBACK_URL_MAX = 512;
export const PREFS_SECRET_MIN = 8;
export const PREFS_SECRET_MAX = 128;

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SECRET_RE = /^[\x21-\x7e]{8,128}$/; // printable ASCII, no spaces

export function validatePrefsPatch(body) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ["body must be an object of { callbackUrl?, callbackSecret?, reapMinutes? }"];
  }
  for (const key of Object.keys(body)) {
    if (!["callbackUrl", "callbackSecret", "reapMinutes"].includes(key)) {
      errors.push(`unknown preference dimension '${key}' (only callbackUrl, callbackSecret, reapMinutes)`);
    }
  }
  const url = body.callbackUrl;
  if (url !== undefined && url !== null) {
    if (typeof url !== "string" || url.length > PREFS_CALLBACK_URL_MAX) {
      errors.push(`callbackUrl must be a string of at most ${PREFS_CALLBACK_URL_MAX} characters`);
    } else {
      let parsed = null;
      try {
        parsed = new URL(url);
      } catch { /* fall through */ }
      if (!parsed || parsed.protocol !== "https:") errors.push("callbackUrl must be an https URL");
    }
  }
  const secret = body.callbackSecret;
  if (secret !== undefined && secret !== null && (typeof secret !== "string" || !SECRET_RE.test(secret))) {
    errors.push(`callbackSecret must be ${PREFS_SECRET_MIN}-${PREFS_SECRET_MAX} printable ASCII characters (no spaces)`);
  }
  // A callback needs BOTH halves; a non-null URL without a (current or new)
  // secret can never be signed, and a secret alone signs nothing.
  const hasUrl = url !== undefined ? url !== null : undefined;
  const hasSecret = secret !== undefined ? secret !== null : undefined;
  if (hasUrl === true && hasSecret === false) errors.push("callbackUrl needs a callbackSecret (set both)");
  if (hasSecret === true && hasUrl === false) errors.push("callbackSecret needs a callbackUrl (set both)");
  const reap = body.reapMinutes;
  if (reap !== undefined && reap !== null && (!Number.isInteger(reap) || reap < PREFS_REAP_MIN_MINUTES || reap > PREFS_REAP_MAX_MINUTES)) {
    errors.push(`reapMinutes must be a whole number of minutes between ${PREFS_REAP_MIN_MINUTES} and ${PREFS_REAP_MAX_MINUTES}`);
  }
  return errors;
}

export function registerPrefsRoutes(app, { core, store, log = null }) {
  const say = log ?? (() => {});

  const authCaller = async (req, res) => {
    const key = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const verdict = await core.authenticate(key);
    if (!verdict.ok) {
      res.status(verdict.status).json({ error: { code: verdict.code, message: verdict.message } });
      return null;
    }
    return verdict.caller;
  };

  const shapeOut = (prefs) => ({
    callbackUrl: prefs?.callbackUrl ?? null,
    callbackSecretSet: Boolean(prefs?.callbackSecret),
    reapMinutes: prefs?.reapMinutes ?? null,
  });

  app.get("/api/wanxing/v1/prefs/:slug", async (req, res) => {
    const caller = await authCaller(req, res);
    if (!caller) return;
    const slug = String(req.params.slug || "").toLowerCase();
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: "invalid agent slug" });
    res.json({ prefs: shapeOut(store.prefsGet(caller.userId, slug)) });
  });

  app.put("/api/wanxing/v1/prefs/:slug", express.json({ limit: "16kb" }), async (req, res) => {
    const caller = await authCaller(req, res);
    if (!caller) return;
    const slug = String(req.params.slug || "").toLowerCase();
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: "invalid agent slug" });
    const body = req.body ?? {};
    const errors = validatePrefsPatch(body);
    // Cross-dimension check against the CURRENT row: clearing only the URL of
    // a live callback would leave a signable-less half — refuse explicitly.
    const cur = store.prefsGet(caller.userId, slug) ?? { callbackUrl: null, callbackSecret: null, reapMinutes: null };
    const nextUrl = body.callbackUrl === undefined ? cur.callbackUrl : body.callbackUrl;
    const nextSecret = body.callbackSecret === undefined ? cur.callbackSecret : body.callbackSecret;
    if ((nextUrl == null) !== (nextSecret == null)) {
      errors.push("callbackUrl and callbackSecret must be set or cleared together");
    }
    if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });
    const next = store.prefsSet(caller.userId, slug, {
      ...(body.callbackUrl !== undefined ? { callbackUrl: body.callbackUrl } : {}),
      ...(body.callbackSecret !== undefined ? { callbackSecret: body.callbackSecret } : {}),
      ...(body.reapMinutes !== undefined ? { reapMinutes: body.reapMinutes } : {}),
    });
    // Audit trail without secrets: which dimensions changed, never values.
    say(`prefs: caller ${caller.userId} ${slug} updated (${Object.keys(body).join(", ") || "no-op"})`);
    res.json({ prefs: shapeOut(next) });
  });
}