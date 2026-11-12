// ── Minimal JSON-Schema checker for the public contract ─────────────────────
//
// Deliberately dependency-free and deliberately SMALL: it supports exactly the
// keywords our contract file uses (`type`, `required`, `properties`, `items`,
// `enum`, `minLength`, `additionalProperties`, and local `$ref` into `$defs`).
// A full implementation would pull in ajv; the contract's job here is to catch
// field renames/removals and type drift, not to be a general validator.
//
// Unknown keywords are ignored on purpose: the contract may grow annotations
// (description, format) without this checker having to learn them.

import { readFileSync } from "node:fs";

function deref(schema, root) {
  let s = schema;
  while (s && typeof s === "object" && typeof s.$ref === "string") {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    if (!m) throw new Error(`unsupported $ref: ${s.$ref}`);
    s = root.$defs?.[m[1]];
    if (!s) throw new Error(`unresolved $ref: ${schema.$ref}`);
  }
  return s;
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v; // string | number | boolean | object | undefined
}

const typeMatches = (v, t) => {
  const actual = typeOf(v);
  if (t === "integer") return actual === "number" && Number.isInteger(v);
  return actual === t;
};

/**
 * Validate a value against a contract sub-schema.
 * @returns {string[]} human-readable error paths; empty means conformant
 */
export function validate(value, schema, root = schema, at = "$") {
  const s = deref(schema, root);
  if (!s || typeof s !== "object") return [];

  const errors = [];

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    // `undefined` (absent key) is allowed to satisfy no type — the caller
    // decides presence via `required`; we only type-check what exists.
    if (value !== undefined && !types.some((t) => typeMatches(value, t))) {
      errors.push(`${at}: expected ${types.join("|")}, got ${typeOf(value)}`);
      return errors;
    }
  }

  if (s.enum !== undefined && value !== undefined && !s.enum.includes(value)) {
    errors.push(`${at}: expected one of ${JSON.stringify(s.enum)}, got ${JSON.stringify(value)}`);
  }

  if (typeof s.minLength === "number" && typeof value === "string" && value.length < s.minLength) {
    errors.push(`${at}: string shorter than minLength ${s.minLength}`);
  }

  if (typeOf(value) === "object") {
    for (const key of s.required ?? []) {
      if (value[key] === undefined) errors.push(`${at}.${key}: required field missing`);
    }
    for (const [key, sub] of Object.entries(s.properties ?? {})) {
      if (value[key] === undefined) continue;
      errors.push(...validate(value[key], sub, root, `${at}.${key}`));
    }
    const ap = s.additionalProperties;
    if (ap && typeof ap === "object") {
      const named = new Set(Object.keys(s.properties ?? {}));
      for (const [key, v] of Object.entries(value)) {
        if (named.has(key)) continue;
        errors.push(...validate(v, ap, root, `${at}.${key}`));
      }
    }
  }

  if (Array.isArray(value) && s.items) {
    value.forEach((v, i) => errors.push(...validate(v, s.items, root, `${at}[${i}]`)));
  }

  return errors;
}

/** Load a contract file and return its revision plus a per-surface validator. */
export function loadContract(fileUrl) {
  const doc = JSON.parse(readFileSync(fileUrl, "utf8"));
  return {
    rev: doc["x-contract-rev"],
    doc,
    /** Validate against a named surface; returns [] when conformant. */
    check(surface, payload) {
      const schema = doc.$defs?.[surface];
      if (!schema) throw new Error(`no such contract surface: ${surface}`);
      return validate(payload, schema, doc);
    },
  };
}
