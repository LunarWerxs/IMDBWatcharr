// WHY: web/src/App.tsx is the whole SPA, and the only thing any gate has ever
// asked of it is that `tsc` and `vite build` accept it - the web lane tests
// lib/api.ts's unfollowFeed and nothing that renders. The Architect's
// complexity finding on App() is only safe to act on if something pins what it
// renders, so this file characterises it: App.tsx is bundled to a single ESM
// file by the same vite that builds it (nothing new is installed), rendered
// with react-dom/server, and asserted against.
//
// The one piece of machinery: App holds its state in useState, and a server
// render only ever sees the initial value, so `useState(...)` seams are
// rewritten in memory to read a probe object the test sets before each render.
// The file on disk is never touched and no behaviour of App itself changes -
// it is a stub, the same way the Worker's D1 is stubbed in worker-routes.
//
// What this does NOT cover: anything that only happens after a render. Effects
// do not run on the server, so the session fetch, the sync poll, the submit
// handler and every state transition are NOT exercised here - only the render
// for a given starting state is.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..", "web");
const PROBE_GLOBAL = "__IMDBWATCH_APP_PROBE__";

// Each seam is the exact text of a useState initialiser in App.tsx and how
// many times it must appear. A count mismatch means App.tsx changed shape and
// this harness can no longer inject that piece of state - fail loudly rather
// than quietly assert nothing.
const PROBE_HELPER = `const __probe = (key) => globalThis.${PROBE_GLOBAL}?.[key];\n`;

const STATE_SEAMS = [
  { from: "useState('')", to: "useState(__probe('sourceUrl') ?? '')", count: 2 },
  { from: "useState(false)", to: "useState(__probe('pending') ?? false)", count: 1 },
  { from: "useState<string | null>(null)", to: "useState<string | null>(__probe('error') ?? null)", count: 1 },
  {
    from: "useState<CreateFeedResponse | null>(null)",
    to: "useState<CreateFeedResponse | null>(__probe('result') ?? null)",
    count: 1,
  },
  {
    from: "useState<Session | null>(null)",
    to: "useState<Session | null>(__probe('session') ?? null)",
    count: 1,
  },
];

function appProbePlugin() {
  return {
    name: "imdbwatch-app-render-probe",
    enforce: "pre",
    transform(source, id) {
      if (!id.replace(/\\/g, "/").endsWith("/src/App.tsx")) {
        return null;
      }

      let code = source;
      for (const seam of STATE_SEAMS) {
        const found = code.split(seam.from).length - 1;
        if (found !== seam.count) {
          throw new Error(
            `test/app-render.test.mjs: expected ${seam.count} of "${seam.from}" in App.tsx but found ${found}. ` +
              "Update the probe in this test to match the new state shape.",
          );
        }
        code = code.split(seam.from).join(seam.to);
      }

      return { code: PROBE_HELPER + code, map: null };
    },
  };
}

const ENTRY = `
import App from "@/App";
import { renderToStaticMarkup } from "react-dom/server";

export function renderApp() {
  return renderToStaticMarkup(<App />);
}
`;

const require = createRequire(path.join(webRoot, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);

// Inside web/node_modules so the externalised react/react-dom imports in the
// bundle resolve, and out of the way of anything the repo tracks.
const outDir = await mkdtemp(path.join(webRoot, "node_modules", ".tmp-app-probe-"));
const entryPath = path.join(outDir, "entry.tsx");

await writeFile(entryPath, ENTRY, "utf8");
await build({
  configFile: false,
  root: webRoot,
  logLevel: "error",
  plugins: [appProbePlugin()],
  resolve: { alias: { "@": path.join(webRoot, "src") } },
  build: {
    ssr: entryPath,
    outDir,
    emptyOutDir: false,
    write: true,
    minify: false,
    target: "esnext",
    rollupOptions: { output: { entryFileNames: "probe.mjs" } },
  },
});

const { renderApp } = await import(pathToFileURL(path.join(outDir, "probe.mjs")).href);

after(async () => {
  delete globalThis[PROBE_GLOBAL];
  await rm(outDir, { recursive: true, force: true });
});

/** Render App with the given pieces of state already in place. */
function render(state = {}) {
  globalThis[PROBE_GLOBAL] = state;
  try {
    return renderApp();
  } finally {
    delete globalThis[PROBE_GLOBAL];
  }
}

/** React separates adjacent text nodes with comment markers, so match across them. */
function text(...parts) {
  return new RegExp(parts.join("[\\s\\S]{0,30}"));
}

const READY_RESULT = {
  slug: "abcdef012345",
  listTitle: "My List",
  radarrRoutePath: "/radarr/l/ls006123300",
  radarrFeedUrl: "https://imdbwatcharr.pages.dev/radarr/l/ls006123300",
  sonarrRoutePath: "/sonarr/l/ls006123300",
  sonarrFeedUrl: "https://imdbwatcharr.pages.dev/sonarr/l/ls006123300",
  status: "ready",
  radarrCount: 12,
  sonarrCount: 3,
  sonarrUnresolvedCount: 2,
  totalCount: 17,
  message: "Ready, and we are keeping it up to date.",
  syncing: false,
  signedIn: true,
  autoRefreshing: true,
};

const SIGNED_IN = { signedIn: true, name: "Ada", authAvailable: true };

describe("App - a first look", () => {
  test("shows the product, the form, the steps and nothing that needs a session", () => {
    const html = render();

    assert.match(html, /Your IMDb list, straight into Radarr and Sonarr\./);
    assert.match(html, /Create your feeds/);
    assert.match(html, /Generate feeds/);
    assert.match(html, /How it works/);
    assert.match(html, /Paste a public IMDb link/);
    assert.match(html, /IMDb Watcharr/);
    assert.match(html, /LunarWerx/);

    // Nothing has been asked of the API yet, so none of the outcome UI exists.
    assert.doesNotMatch(html, /Radarr RSS URL/);
    assert.doesNotMatch(html, /Could not build the feeds/);
    assert.doesNotMatch(html, /Reading IMDb/);
    assert.doesNotMatch(html, /This one will not update by itself/);
    assert.doesNotMatch(html, /Sign out/);
  });

  test("the hint offers the example link while the field is empty", () => {
    const html = render();

    assert.match(html, /https:\/\/www\.imdb\.com\/list\/ls006123300\//);
    assert.doesNotMatch(html, /That does not look like an IMDb list or watchlist link\./);
    assert.doesNotMatch(html, /aria-invalid="true"/);
  });

  test("the hint turns into a complaint on something that is not an IMDb link", () => {
    const html = render({ sourceUrl: "https://example.com/nope" });

    assert.match(html, /That does not look like an IMDb list or watchlist link\./);
    assert.match(html, /aria-invalid="true"/);
  });

  test("a list URL typed in keeps the hint calm", () => {
    const html = render({ sourceUrl: "https://www.imdb.com/list/ls006123300/" });

    assert.doesNotMatch(html, /That does not look like an IMDb list or watchlist link\./);
    assert.doesNotMatch(html, /aria-invalid="true"/);
  });
});

describe("App - while a first sync is in flight", () => {
  test("pending replaces the button label, shows skeletons, and claims no result", () => {
    const html = render({ sourceUrl: "https://www.imdb.com/list/ls006123300/", pending: true });

    assert.match(html, /Reading IMDb/);
    assert.match(html, /animate-spin/);
    assert.doesNotMatch(html, /Generate feeds/);
    assert.doesNotMatch(html, /Radarr RSS URL/);
  });

  test("an error is shown as the reason nothing was built", () => {
    const html = render({ error: "That link is not a public IMDb list or watchlist." });

    assert.match(html, /Could not build the feeds/);
    assert.match(html, /That link is not a public IMDb list or watchlist\./);
    assert.doesNotMatch(html, /Radarr RSS URL/);
  });

  test("a pending render wins over a stale error, so the two never stack", () => {
    const html = render({ error: "Old news.", pending: true });

    assert.doesNotMatch(html, /Could not build the feeds/);
    assert.match(html, /Reading IMDb/);
  });
});

describe("App - a finished result", () => {
  test("reports the counts, both feed URLs and the state message", () => {
    const html = render({ result: READY_RESULT });

    assert.match(html, />17<\/div><div class="[^"]*">Titles on the list</);
    assert.match(html, />12<\/div><div class="[^"]*">Movies for Radarr</);
    assert.match(html, />3<\/div><div class="[^"]*">Shows for Sonarr</);
    assert.match(html, />2<\/div><div class="[^"]*">Shows we skipped</);

    assert.match(html, /My List/);
    assert.match(html, /https:\/\/imdbwatcharr\.pages\.dev\/radarr\/l\/ls006123300/);
    assert.match(html, /https:\/\/imdbwatcharr\.pages\.dev\/sonarr\/l\/ls006123300/);
    assert.match(html, /Radarr RSS URL/);
    assert.match(html, /Sonarr custom list URL/);
    assert.match(html, /Ready, and we are keeping it up to date\./);
  });

  test("a ready feed is badged with its status and flagged as kept current", () => {
    const html = render({ result: READY_RESULT, session: SIGNED_IN });

    assert.match(html, />ready</);
    assert.doesNotMatch(html, /animate-spin/);
    assert.doesNotMatch(html, /This one will not update by itself/);
    assert.match(html, /Shows we skipped/);
  });

  test("shows that would be left out of Sonarr are explained", () => {
    const html = render({ result: READY_RESULT });

    assert.match(
      html,
      text("we could not find one for", "2", "of them, so we left those out\\."),
    );
  });

  test("a feed with nothing skipped says nothing about skipping", () => {
    const html = render({ result: { ...READY_RESULT, sonarrUnresolvedCount: 0 } });

    assert.doesNotMatch(html, /so we left those out/);
    assert.match(html, />0<\/div><div class="[^"]*">Shows we skipped</);
  });

  test("a feed still fetching is badged as fetching, not by its raw status", () => {
    const html = render({
      result: { ...READY_RESULT, status: "pending", totalCount: 0, radarrCount: 0, sonarrCount: 0, syncing: true },
    });

    assert.match(html, />fetching</);
    assert.match(html, /animate-spin/);
    assert.doesNotMatch(html, />pending</);
  });

  test("a failed sync that still has items says it is serving the last good snapshot", () => {
    const html = render({
      result: {
        ...READY_RESULT,
        status: "error",
        message: "We could not reach IMDb just now.",
        syncing: false,
      },
    });

    assert.match(html, />last good snapshot</);
    assert.match(
      html,
      text("The last sync did not succeed, so the feeds keep serving the last good snapshot\\.", "We could not reach IMDb just now\\."),
    );
  });
});

describe("App - the signed-out nudge", () => {
  const UNSYNCED = { ...READY_RESULT, signedIn: false, autoRefreshing: false };

  test("a signed-out visitor with a working feed is told it will not update by itself", () => {
    const html = render({
      result: UNSYNCED,
      session: { signedIn: false, name: null, authAvailable: true },
    });

    assert.match(html, /This one will not update by itself/);
    assert.match(html, /Sign in with Connections/);
    assert.match(html, /Your links work now and will keep working\./);
  });

  test("a signed-in visitor is not nagged, and gets the account controls instead", () => {
    const html = render({ result: READY_RESULT, session: SIGNED_IN });

    assert.doesNotMatch(html, /This one will not update by itself/);
    assert.match(html, /Ada/);
    assert.match(html, /Sign out/);
  });

  test("nothing is said about updating before there is a result to update", () => {
    const html = render({ session: { signedIn: false, name: null, authAvailable: true } });

    assert.doesNotMatch(html, /This one will not update by itself/);
  });
});
