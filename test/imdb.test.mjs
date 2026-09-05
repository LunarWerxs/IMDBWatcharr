// WHY: node --test discovery over src/imdb.js's pure logic - URL
// normalization, route parsing, and feed filtering are what stand between a
// pasted IMDb URL and a feed row Radarr/Sonarr will poll forever, so a
// regression here is silent until a real user's list breaks. Ports the
// assertions scripts/test-parser.mjs already made (kept running via
// `npm run check`) into standard node:test cases so `npm test` discovers
// them and a syntax slip fails the gate on its own.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCachedFeedXmlTemplate,
  buildPublicFeedPath,
  buildSonarrCustomListPayload,
  FEED_ALERT_FAILURE_THRESHOLD,
  filterItemsForTarget,
  injectPublicOrigin,
  isFeedAlerting,
  normalizeImdbUrl,
  parseFeedRoute,
  summarizeItemsByTarget,
} from "../src/imdb.js";

describe("normalizeImdbUrl", () => {
  test("canonicalizes a list URL and strips query params", () => {
    const result = normalizeImdbUrl("https://www.imdb.com/list/ls008777572/?sort=list_order,asc");
    assert.equal(result.canonicalUrl, "https://www.imdb.com/list/ls008777572/");
    assert.equal(result.sourceKind, "list");
    assert.equal(result.sourceKey, "ls008777572");
  });

  test("canonicalizes a watchlist URL and adds the trailing slash", () => {
    const result = normalizeImdbUrl("https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist");
    assert.equal(result.canonicalUrl, "https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist/");
    assert.equal(result.sourceKind, "watchlist");
  });

  test("accepts an already-resolved ur watchlist id", () => {
    const result = normalizeImdbUrl("https://www.imdb.com/user/ur15738437/watchlist/");
    assert.equal(result.sourceKey, "ur15738437");
  });

  // These exact shapes reached production and then failed on every sync run
  // forever - see the same guard in scripts/test-parser.mjs.
  for (const junkUrl of [
    "https://www.imdb.com/user/profile-id/watchlist/",
    "https://www.imdb.com/user/7bcfe5d072f7.xml/watchlist/",
    "https://www.imdb.com/user/ur/watchlist/",
    "https://example.com/list/ls008777572/",
  ]) {
    test(`rejects a URL that is not a real IMDb list/watchlist: ${junkUrl}`, () => {
      assert.throws(() => normalizeImdbUrl(junkUrl));
    });
  }
});

describe("buildPublicFeedPath", () => {
  test("builds the radarr path for a list by default", () => {
    const normalized = normalizeImdbUrl("https://www.imdb.com/list/ls008777572/");
    assert.equal(buildPublicFeedPath(normalized), "/radarr/l/ls008777572");
  });

  test("builds the sonarr path for a watchlist", () => {
    const normalized = normalizeImdbUrl("https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist/");
    assert.equal(buildPublicFeedPath(normalized, "sonarr"), "/sonarr/p/p.kdbeq6dtmzzpiin4k7t4fnunf4");
  });

  test("rejects a feed target that is neither radarr nor sonarr", () => {
    const normalized = normalizeImdbUrl("https://www.imdb.com/list/ls008777572/");
    assert.throws(() => buildPublicFeedPath(normalized, "plex"), /Unsupported feed target/);
  });
});

describe("parseFeedRoute", () => {
  test("parses a targeted watchlist route", () => {
    const route = parseFeedRoute("/radarr/p/p.kdbeq6dtmzzpiin4k7t4fnunf4");
    assert.equal(route.feedTarget, "radarr");
    assert.equal(route.sourceKind, "watchlist");
    assert.equal(route.canonicalUrl, "https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist/");
  });

  test("parses a targeted sonarr list route", () => {
    const route = parseFeedRoute("/sonarr/l/ls008777572");
    assert.equal(route.feedTarget, "sonarr");
    assert.equal(route.sourceKind, "list");
  });

  test("an untargeted watchlist route defaults to radarr", () => {
    assert.equal(parseFeedRoute("/p/p.kdbeq6dtmzzpiin4k7t4fnunf4")?.feedTarget, "radarr");
  });

  test("an untargeted list route defaults to radarr", () => {
    assert.equal(parseFeedRoute("/l/ls008777572")?.feedTarget, "radarr");
  });

  test("the generic /f/ route infers list vs watchlist from the key shape", () => {
    assert.equal(parseFeedRoute("/f/ls008777572")?.sourceKind, "list");
    assert.equal(parseFeedRoute("/f/ur15738437")?.sourceKind, "watchlist");
    assert.equal(parseFeedRoute("/sonarr/f/ls008777572")?.feedTarget, "sonarr");
  });

  // Same junk-route guard as scripts/test-parser.mjs: none of these may
  // resolve to a feed, or a bad paste creates a row that fails forever.
  for (const junk of [
    "/p/profile-id",
    "/p/7bcfe5d072f7.xml",
    "/radarr/p/profile-id",
    "/radarr/p/some-slug.xml",
    "/f/p.",
    "/f/urabc",
    "/l/ls",
    "/nonsense",
  ]) {
    test(`route ${junk} does not resolve to a feed`, () => {
      assert.equal(parseFeedRoute(junk), null);
    });
  }
});

describe("filterItemsForTarget / summarizeItemsByTarget", () => {
  const items = [
    { titleType: "movie" },
    { titleType: "tvMovie" },
    { titleType: "tvSeries" },
    { titleType: "tvMiniSeries" },
    { titleType: "videoGame" },
  ];

  test("radarr keeps only movie and tvMovie", () => {
    assert.equal(filterItemsForTarget(items, "radarr").length, 2);
  });

  test("sonarr keeps only tvSeries and tvMiniSeries", () => {
    assert.equal(filterItemsForTarget(items, "sonarr").length, 2);
  });

  test("falls back to a snake_case title_type field", () => {
    assert.equal(filterItemsForTarget([{ title_type: "movie" }], "radarr").length, 1);
  });

  test("rejects an unsupported feed target", () => {
    assert.throws(() => filterItemsForTarget(items, "plex"), /Unsupported feed target/);
  });

  test("summarize reports both counts and the total", () => {
    assert.deepEqual(summarizeItemsByTarget(items), { radarr: 2, sonarr: 2, total: 5 });
  });
});

describe("buildSonarrCustomListPayload", () => {
  test("keeps only TV items with a positive integer TVDB id", () => {
    const payload = buildSonarrCustomListPayload([
      { title: "Game of Thrones", title_type: "tvSeries", tvdb_id: 121361 },
      { title: "Forrest Gump", title_type: "movie", tvdb_id: 999999 },
      { title: "Unknown Show", title_type: "tvSeries", tvdb_id: null },
      { title: "Zero Show", title_type: "tvSeries", tvdb_id: 0 },
    ]);
    assert.deepEqual(payload, [{ Title: "Game of Thrones", TvdbId: 121361 }]);
  });
});

describe("isFeedAlerting", () => {
  test("does not alert below the threshold", () => {
    assert.equal(isFeedAlerting(0), false);
    assert.equal(isFeedAlerting(FEED_ALERT_FAILURE_THRESHOLD - 1), false);
  });

  test("alerts at and beyond the threshold", () => {
    assert.equal(isFeedAlerting(FEED_ALERT_FAILURE_THRESHOLD), true);
    assert.equal(isFeedAlerting(FEED_ALERT_FAILURE_THRESHOLD + 5), true);
  });

  test("treats a missing failure count as zero, not as alerting", () => {
    assert.equal(isFeedAlerting(null), false);
    assert.equal(isFeedAlerting(undefined), false);
  });
});

describe("feed XML rendering", () => {
  test("the cached template keeps the origin placeholder, and injection resolves the real feed URL", () => {
    const normalized = normalizeImdbUrl("https://www.imdb.com/list/ls008777572/");
    const template = buildCachedFeedXmlTemplate(
      { source_url: normalized.canonicalUrl, list_title: "Test List", last_synced_at: "2026-04-15T12:00:00.000Z" },
      [{ imdb_id: "tt0000001", title: "Something", title_type: "movie", year: 2020 }],
    );
    assert.match(template, /__IMDBWATCHARR_PUBLIC_ORIGIN__/);

    const injected = injectPublicOrigin(template, "https://example.com");
    assert.match(injected, /https:\/\/example\.com\/radarr\/l\/ls008777572/);
    assert.doesNotMatch(injected, /__IMDBWATCHARR_PUBLIC_ORIGIN__/);
  });
});
