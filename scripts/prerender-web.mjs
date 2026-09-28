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
import { execFileSync } from "node:child_process";
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

  const { render, structuredData } = await import(pathToFileURL(path.join(outDir, "prerender.mjs")).href);
  const markup = render();
  if (!markup || !markup.includes("<main")) {
    throw new Error("prerender-web: the render produced no <main>; refusing to write an empty shell");
  }

  const html = await readFile(indexPath, "utf8");
  const found = html.split(EMPTY_ROOT).length - 1;
  if (found !== 1) {
    throw new Error(`prerender-web: expected exactly one ${EMPTY_ROOT} in web/dist/index.html, found ${found}`);
  }
  if (html.split("</head>").length !== 2) {
    throw new Error("prerender-web: expected exactly one </head> in web/dist/index.html");
  }
  const page = html.replace(EMPTY_ROOT, `<div id="root">${markup}</div>`).replace("</head>", `    ${structuredData()}
  </head>`);
  await writeFile(indexPath, page, "utf8");
  console.log(`prerender-web: wrote ${(markup.length / 1024).toFixed(1)} kB of first-view HTML into web/dist/index.html`);
  await stampSitemap();
} finally {
  await rm(outDir, { recursive: true, force: true });
}

// Each sitemap entry's <lastmod> is the day its source last changed in git, so
// a search engine is told the truth about what is new instead of a date typed
// in once and left to go stale. Without git (a tarball build) the dates in
// web/public/sitemap.xml stand.
async function stampSitemap() {
  const sitemapPath = path.join(webRoot, "dist", "sitemap.xml");
  const sources = {
    "/": ["web/index.html", "web/src"],
    "/llms.txt": ["web/public/llms.txt"],
    "/llms-full.txt": ["web/public/llms-full.txt"],
    "/pricing.md": ["web/public/pricing.md"],
  };
  let sitemap = await readFile(sitemapPath, "utf8");
  for (const [route, paths] of Object.entries(sources)) {
    let day;
    try {
      day = execFileSync("git", ["log", "-1", "--format=%cs", "--", ...paths], {
        cwd: path.join(webRoot, ".."),
        encoding: "utf8",
      }).trim();
    } catch {
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const at = sitemap.indexOf(`<loc>https://watcharr.lunarwerx.com${route}</loc>`);
    const open = at < 0 ? -1 : sitemap.indexOf("<lastmod>", at);
    const close = open < 0 ? -1 : sitemap.indexOf("</lastmod>", open);
    if (close < 0) continue;
    sitemap = `${sitemap.slice(0, open + "<lastmod>".length)}${day}${sitemap.slice(close)}`;
  }
  await writeFile(sitemapPath, sitemap, "utf8");
  console.log("prerender-web: stamped the sitemap's lastmod dates from git");
}
