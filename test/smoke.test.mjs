// WHY: on 2026-08-18 src/index.js did not parse for weeks because nothing in
// the gate ever loaded it - scripts/test-parser.mjs only imports src/imdb.js
// and src/imdb-graphql.js, and CI never ran node --check over the rest of
// src/. A plain import of every module under src/ turns a syntax error or a
// broken top-level import into a failing test instead of a silent outage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

test("every module under src/ imports without throwing", async () => {
  const files = (await readdir(srcDir)).filter((name) => name.endsWith(".js"));
  assert.ok(files.length > 0, "expected at least one source file under src/ - the discovery itself is broken if this is empty");

  for (const file of files) {
    const moduleUrl = pathToFileURL(path.join(srcDir, file)).href;
    const mod = await import(moduleUrl);
    assert.ok(mod, `${file} should import cleanly`);
  }
});

test("src/index.js exports a Worker fetch handler", async () => {
  const mod = await import(pathToFileURL(path.join(srcDir, "index.js")).href);
  assert.equal(
    typeof mod.default?.fetch,
    "function",
    "the Worker's default export should expose a fetch(request, env, ctx) handler",
  );
});
