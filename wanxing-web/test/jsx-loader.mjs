// Module-hooks loader: transform JSX with esbuild (already in the tree via
// vite) so plain `node --test` can import view modules directly. Registered
// by test/register.mjs; only .jsx is intercepted — plain .js passes through.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

export async function load(url, context, next) {
  if (url.endsWith(".jsx")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { code } = transformSync(source, {
      loader: "jsx",
      jsx: "automatic",
      format: "esm",
      sourcefile: url,
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return next(url, context);
}
