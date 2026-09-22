// Bakes the SPA's first view into web/dist/index.html after `vite build`.
//
// WHY: the page is a client-rendered React app, so until this existed a phone
// saw a blank screen until the whole bundle (~118 kB gzipped) had downloaded
// and run: first paint and the largest paint were both the moment React
// finished. With the first view already in the HTML, the page paints as soon as
// the HTML and the stylesheet arrive, and web/src/main.tsx hydrates it in place.
//
// How: the same vite and the same web/vite.config.ts (aliases, the build-time
// __APP_VERSION__ define) build web/src/entry-prerender.tsx for the server into
// a scratch folder, it renders <Root />, and the markup goes into the empty
// <div id="root"></div> that vite wrote. Nothing new is installed; the scratch
// folder is deleted afterwards. Run by web's `build` script, so `npm run deploy`
// and CI's build both get it.
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..", "web");
const indexPath = path.join(webRoot, "dist", "index.html");
const EMPTY_ROOT = '<div id="root"></div>';

const require = createRequire(path.join(webRoot, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);

// Inside web/node_modules so the externalised react/react-dom imports resolve.
const outDir = await mkdtemp(path.join(webRoot, "node_modules", ".tmp-prerender-"));
try {
  await build({
    configFile: path.join(webRoot, "vite.config.ts"),
    root: webRoot,
    logLevel: "error",
    build: {
      ssr: path.join(webRoot, "src", "entry-prerender.tsx"),
      outDir,
      emptyOutDir: false,
      minify: false,
      target: "esnext",
      rollupOptions: { output: { entryFileNames: "prerender.mjs" } },
    },
  });

  const { render } = await import(pathToFileURL(path.join(outDir, "prerender.mjs")).href);
  const markup = render();
  if (!markup || !markup.includes("<main")) {
    throw new Error("prerender-web: the render produced no <main>; refusing to write an empty shell");
  }

  const html = await readFile(indexPath, "utf8");
  const found = html.split(EMPTY_ROOT).length - 1;
  if (found !== 1) {
    throw new Error(`prerender-web: expected exactly one ${EMPTY_ROOT} in web/dist/index.html, found ${found}`);
  }
  await writeFile(indexPath, html.replace(EMPTY_ROOT, `<div id="root">${markup}</div>`), "utf8");
  console.log(`prerender-web: wrote ${(markup.length / 1024).toFixed(1)} kB of first-view HTML into web/dist/index.html`);
} finally {
  await rm(outDir, { recursive: true, force: true });
}
