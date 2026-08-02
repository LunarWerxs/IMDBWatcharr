import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPublicFeedPath,
  buildCachedFeedXmlTemplate,
  buildSonarrCustomListPayload,
  filterItemsForTarget,
  hashText,
  injectPublicOrigin,
  normalizeImdbUrl,
  parseFeedRoute,
  summarizeItemsByTarget,
} from "../src/imdb.js";
import { buildSnapshotFingerprintPayload, fetchImdbList } from "../src/imdb-graphql.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejects(promise, match, message) {
  try {
    await promise;
  } catch (error) {
    assert(match.test(error.message), `${message} (got: ${error.message})`);
    return;
  }

  throw new Error(message);
}

async function readFixture(name) {
  return JSON.parse(await readFile(path.join(rootDir, "fixtures", name), "utf8"));
}

/**
 * A fetch stand-in that answers each GraphQL call from a queue, and records the
 * variables it was called with so paging and profile resolution can be checked.
 */
function stubFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const next = queue.shift();
    if (!next) {
      throw new Error("Stub fetch ran out of responses.");
    }
    if (typeof next === "function") {
      return next(body);
    }
    return { ok: true, status: 200, json: async () => next };
  };
  impl.calls = calls;
  return impl;
}

// --- URL normalization and routing -----------------------------------------

const listUrl = normalizeImdbUrl("https://www.imdb.com/list/ls008777572/?sort=list_order,asc");
assert(listUrl.canonicalUrl === "https://www.imdb.com/list/ls008777572/", "List URL normalization failed.");
assert(buildPublicFeedPath(listUrl) === "/radarr/l/ls008777572", "List feed path generation failed.");
assert(buildPublicFeedPath(listUrl, "sonarr") === "/sonarr/l/ls008777572", "List Sonarr path generation failed.");

const watchlistUrl = normalizeImdbUrl("https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist");
assert(watchlistUrl.canonicalUrl === "https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist/", "Watchlist URL normalization failed.");
assert(buildPublicFeedPath(watchlistUrl) === "/radarr/p/p.kdbeq6dtmzzpiin4k7t4fnunf4", "Watchlist feed path generation failed.");
assert(buildPublicFeedPath(watchlistUrl, "sonarr") === "/sonarr/p/p.kdbeq6dtmzzpiin4k7t4fnunf4", "Watchlist Sonarr path generation failed.");

const parsedListRoute = parseFeedRoute("/l/ls008777572");
assert(parsedListRoute?.canonicalUrl === listUrl.canonicalUrl, "Direct list route parsing failed.");

const parsedWatchlistRoute = parseFeedRoute("/p/p.kdbeq6dtmzzpiin4k7t4fnunf4");
assert(parsedWatchlistRoute?.canonicalUrl === watchlistUrl.canonicalUrl, "Direct watchlist route parsing failed.");
assert(parsedWatchlistRoute?.feedTarget === "radarr", "Default watchlist route should map to Radarr.");

const parsedSonarrListRoute = parseFeedRoute("/sonarr/l/ls008777572");
assert(parsedSonarrListRoute?.canonicalUrl === listUrl.canonicalUrl, "Direct Sonarr list route parsing failed.");
assert(parsedSonarrListRoute?.feedTarget === "sonarr", "Direct Sonarr list route should map to Sonarr.");

const parsedGenericRoute = parseFeedRoute("/f/ls008777572");
assert(parsedGenericRoute?.canonicalUrl === listUrl.canonicalUrl, "Generic feed route parsing failed for lists.");

const parsedSonarrGenericRoute = parseFeedRoute("/sonarr/f/ls008777572");
assert(parsedSonarrGenericRoute?.canonicalUrl === listUrl.canonicalUrl, "Generic Sonarr route parsing failed for lists.");
assert(parsedSonarrGenericRoute?.feedTarget === "sonarr", "Generic Sonarr route should map to Sonarr.");

assert(parseFeedRoute("/p/ur15738437")?.sourceKey === "ur15738437", "A ur watchlist route should parse.");
assert(parseFeedRoute("/radarr/f/ur15738437")?.sourceKind === "watchlist", "A ur generic route should parse as a watchlist.");

// Anything that is not a real IMDb identifier must not create a feed row: these
// exact shapes reached production and then failed on every sync run forever.
for (const junk of [
  "/p/profile-id",
  "/p/7bcfe5d072f7.xml",
  "/radarr/p/profile-id",
  "/radarr/p/some-slug.xml",
  "/f/p.",
  "/f/urabc",
  "/l/ls",
]) {
  assert(parseFeedRoute(junk) === null, `Route ${junk} should not resolve to a feed.`);
}

for (const junkUrl of [
  "https://www.imdb.com/user/profile-id/watchlist/",
  "https://www.imdb.com/user/7bcfe5d072f7.xml/watchlist/",
  "https://www.imdb.com/user/ur/watchlist/",
]) {
  let rejected = false;
  try {
    normalizeImdbUrl(junkUrl);
  } catch {
    rejected = true;
  }
  assert(rejected, `URL ${junkUrl} should be rejected.`);
}

// --- Lists through the GraphQL API ------------------------------------------

const listFixture = await readFixture("list-graphql.json");
const listFetch = stubFetch([listFixture]);
const parsedList = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls006123300/"), listFetch);

assert(parsedList.parserMode === "graphql", "List should parse through the GraphQL payload.");
assert(listFetch.calls.length === 1, "A single-page list should take exactly one request.");
assert(listFetch.calls[0].variables.id === "ls006123300", "List query should be keyed on the list id.");
assert(listFetch.calls[0].variables.after === null, "The first page should not send a cursor.");
assert(parsedList.items.length === 3, "List fixture should expose 3 raw items.");
assert(parsedList.listTitle === "WATCHLIST", "List title should come from the list name.");
assert(parsedList.listAuthor === "IMikeDB", "List author should come from the author username.");
assert(parsedList.listId === "ls006123300", "List id should be carried through.");
assert(parsedList.lastSourceModifiedAt === "2026-07-31T08:26:46Z", "List modified date should be carried through.");
assert(parsedList.items[0].imdbId === "tt0423977", "First item should keep its IMDb id.");
assert(parsedList.items[0].title === "Charlie Bartlett", "First item should keep its title.");
assert(parsedList.items[0].year === 2007, "First item should keep its release year.");
assert(parsedList.items[0].position === 1, "First item should keep its absolute position.");
assert(parsedList.items[0].addedAt?.startsWith("2014-07-31"), "First item should keep its added date.");
assert(filterItemsForTarget(parsedList.items, "radarr").length === 2, "List fixture should expose 2 movie items for Radarr.");
assert(filterItemsForTarget(parsedList.items, "sonarr").length === 1, "List fixture should expose 1 series item for Sonarr.");

const listCounts = summarizeItemsByTarget(parsedList.items);
assert(listCounts.radarr === 2 && listCounts.sonarr === 1 && listCounts.total === 3, "List fixture count summary failed.");

const sonarrPayload = buildSonarrCustomListPayload([
  { title: "Game of Thrones", title_type: "tvSeries", tvdb_id: 121361 },
  { title: "Forrest Gump", title_type: "movie", tvdb_id: 999999 },
  { title: "Unknown Show", title_type: "tvSeries", tvdb_id: null },
]);
assert(sonarrPayload.length === 1, "Sonarr payload should only include TV items with TVDB IDs.");
assert(sonarrPayload[0].Title === "Game of Thrones" && sonarrPayload[0].TvdbId === 121361, "Sonarr payload mapping failed.");

const listFingerprintPayload = buildSnapshotFingerprintPayload(parsedList);
assert(listFingerprintPayload.includes('"parserMode":"graphql"'), "Fingerprint payload should record the GraphQL parser mode.");
assert(listFingerprintPayload.includes('"listId":"ls006123300"'), "Fingerprint payload should include the list id.");
const fingerprintHash = await hashText(listFingerprintPayload, 16);
assert(/^[a-f0-9]{16}$/.test(fingerprintHash), "Fingerprint hash should be a stable hex digest.");

// The same list fetched twice has to hash the same, or every sync rebuilds.
const repeatList = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls006123300/"), stubFetch([listFixture]));
assert(
  buildSnapshotFingerprintPayload(repeatList) === listFingerprintPayload,
  "The same list payload must produce the same fingerprint.",
);

// --- Watchlists through the GraphQL API -------------------------------------

const watchlistFixture = await readFixture("watchlist-graphql.json");
const profileFixture = await readFixture("profile-graphql.json");

const watchlistFetch = stubFetch([profileFixture, watchlistFixture]);
const parsedWatchlist = await fetchImdbList(watchlistUrl, watchlistFetch);
assert(parsedWatchlist.items.length === 3, "Watchlist fixture should expose 3 items.");
assert(watchlistFetch.calls.length === 2, "A p. watchlist should resolve the profile, then fetch the list.");
assert(
  watchlistFetch.calls[0].variables.profileId === "p.kdbeq6dtmzzpiin4k7t4fnunf4",
  "The first watchlist call should translate the obfuscated profile id.",
);
assert(watchlistFetch.calls[1].variables.userId === "ur15738437", "The watchlist call should use the resolved ur id.");
assert(filterItemsForTarget(parsedWatchlist.items, "radarr").length === 3, "Watchlist fixture should keep all sample items for Radarr.");
assert(filterItemsForTarget(parsedWatchlist.items, "sonarr").length === 0, "Watchlist fixture should expose no series items for Sonarr.");

// A ur… watchlist is already a user id, so it must skip the profile lookup.
const directWatchlistFetch = stubFetch([watchlistFixture]);
const directWatchlist = await fetchImdbList(
  normalizeImdbUrl("https://www.imdb.com/user/ur15738437/watchlist/"),
  directWatchlistFetch,
);
assert(directWatchlistFetch.calls.length === 1, "A ur watchlist should not need a profile lookup.");
assert(directWatchlistFetch.calls[0].variables.userId === "ur15738437", "A ur watchlist should query that user directly.");
assert(directWatchlist.items.length === 3, "A ur watchlist should return the same items.");

// --- Paging -----------------------------------------------------------------

function pageOf(edges, hasNextPage, endCursor) {
  return {
    data: {
      list: {
        id: "ls000000001",
        name: { originalText: "Paged" },
        lastModifiedDate: "2026-08-01T00:00:00Z",
        author: { userId: "ur1", username: { text: "someone" } },
        titleListItemSearch: {
          total: 4,
          pageInfo: { hasNextPage, endCursor },
          edges,
        },
      },
    },
  };
}

function edgeOf(id, position, titleType = "movie") {
  return {
    node: { absolutePosition: position, createdDate: "2026-01-01T00:00:00.000Z" },
    title: {
      id,
      titleText: { text: `Title ${id}` },
      originalTitleText: { text: `Title ${id}` },
      titleType: { id: titleType },
      releaseYear: { year: 2020 },
    },
  };
}

const pagedFetch = stubFetch([
  pageOf([edgeOf("tt0000001", 1), edgeOf("tt0000002", 2)], true, "cursor-1"),
  pageOf([edgeOf("tt0000003", 3), edgeOf("tt0000004", 4)], false, null),
]);
const pagedList = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"), pagedFetch);
assert(pagedFetch.calls.length === 2, "A two-page list should take two requests.");
assert(pagedFetch.calls[1].variables.after === "cursor-1", "The second page should send the previous end cursor.");
assert(pagedList.items.length === 4, "Paging should collect every page.");
assert(
  pagedList.items.map((item) => item.imdbId).join(",") === "tt0000001,tt0000002,tt0000003,tt0000004",
  "Paging should preserve list order across pages.",
);
assert(pagedList.totalItems === 4, "Total should reflect the collected items.");

// feed_items is keyed on (feed_id, imdb_id), so a repeated title has to collapse
// rather than fail the insert batch.
const dupeFetch = stubFetch([
  pageOf([edgeOf("tt0000001", 1), edgeOf("tt0000002", 2)], true, "cursor-1"),
  pageOf([edgeOf("tt0000001", 3), edgeOf("tt0000003", 4)], false, null),
]);
const dedupedList = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"), dupeFetch);
assert(dedupedList.items.length === 3, "A duplicated title should be collapsed.");
assert(
  dedupedList.items.map((item) => item.imdbId).join(",") === "tt0000001,tt0000002,tt0000003",
  "Dedupe should keep the first occurrence in list order.",
);
assert(dedupedList.items[0].position === 1, "Dedupe should keep the earliest position.");

// A page that claims more but returns nothing must terminate, not spin.
const emptyTailFetch = stubFetch([
  pageOf([edgeOf("tt0000001", 1)], true, "cursor-1"),
  pageOf([], true, "cursor-2"),
]);
const emptyTailList = await fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"), emptyTailFetch);
assert(emptyTailList.items.length === 1, "An empty follow-up page should end paging.");

// --- Failure modes ----------------------------------------------------------

await assertRejects(
  fetchImdbList(normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"), stubFetch([{ data: { list: null } }])),
  /no public list called/i,
  "A missing list should be rejected.",
);

await assertRejects(
  fetchImdbList(
    normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"),
    stubFetch([{ errors: [{ message: "Something unexpected" }] }]),
  ),
  /IMDb GraphQL error: Something unexpected/,
  "A GraphQL error should surface its message.",
);

// IMDb answers a missing id with a Java stack-trace string; the user gets a
// sentence instead.
await assertRejects(
  fetchImdbList(
    normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"),
    stubFetch([
      {
        errors: [
          {
            message:
              "RESOURCE_NOT_FOUND exception code while fetching data (/list/author) : imdb.list.graphql.domain.data.DataFetchingException: Not found",
          },
        ],
      },
    ]),
  ),
  /^IMDb has nothing public at that link\. It may be private, or the id may be wrong\.$/,
  "A missing list should be reported in plain language.",
);

await assertRejects(
  fetchImdbList(
    normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"),
    stubFetch([() => ({ ok: false, status: 403, json: async () => ({}) })]),
  ),
  /status 403/,
  "A non-200 response should be rejected.",
);

await assertRejects(
  fetchImdbList(watchlistUrl, stubFetch([{ data: { userProfile: null } }])),
  /no public profile at/i,
  "An unresolvable profile should be rejected.",
);

// Truncating a feed silently would drop titles, so runaway paging must throw.
await assertRejects(
  fetchImdbList(
    normalizeImdbUrl("https://www.imdb.com/list/ls000000001/"),
    stubFetch(Array.from({ length: 41 }, (_, index) => pageOf([edgeOf(`tt000${index + 1000}`, index + 1)], true, `c${index}`))),
  ),
  /did not finish paging/,
  "Runaway paging should fail rather than truncate.",
);

// --- Feed rendering ---------------------------------------------------------

const cachedXmlTemplate = buildCachedFeedXmlTemplate(
  {
    source_url: listUrl.canonicalUrl,
    list_title: "Top 35 Movies For Public",
    last_synced_at: "2026-04-15T12:00:00.000Z",
  },
  filterItemsForTarget(parsedList.items, "radarr"),
);
assert(cachedXmlTemplate.includes("__IMDBWATCHARR_PUBLIC_ORIGIN__"), "Cached XML should preserve the public-origin placeholder.");
const injectedXml = injectPublicOrigin(cachedXmlTemplate, "https://imdbwatcharr.pages.dev");
assert(injectedXml.includes("https://imdbwatcharr.pages.dev/radarr/l/ls008777572"), "Public origin injection should produce the final route.");

console.log("Parser checks passed.");
