// Shared lists (src/shared-lists.js): one Radarr link and one Sonarr link fed by
// several IMDb lists, which several signed-in people add to. What is pinned
// here is what the stub D1 can prove: the links serve every list's titles once,
// who may change a shared list, and what the page is told about the people in
// it. The SQL itself (the joins, the "only what you added" delete, the sync
// schedule taking shared lists in) is only proven against a real D1.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ORIGIN, SESSION_SECRET, RECENT, makeDb, makeEnv, call, sessionCookie } from "./support/worker-harness.mjs";

const SLUG = "0123456789ab";
const INVITE = "f".repeat(32);
const SHARED = { id: 3, slug: SLUG, name: "Family", updated_at: RECENT };

const MOM_LIST = "Mom's watchlist";
const KID_LIST = "Kid's list";
const MOVIES = [
  { imdb_id: "tt0111161", tmdb_id: 278, title: "The Shawshank Redemption", year: 1994, title_type: "movie", source_title: MOM_LIST },
  { imdb_id: "tt1375666", tmdb_id: 27205, title: "Inception", year: 2010, title_type: "movie", source_title: MOM_LIST },
  { imdb_id: "tt0111161", tmdb_id: 278, title: "The Shawshank Redemption", year: 1994, title_type: "movie", source_title: KID_LIST },
  { imdb_id: "tt9999999", tmdb_id: null, title: "Not On TMDB Yet", year: 2026, title_type: "movie", source_title: KID_LIST },
];
const SHOWS = [
  { imdb_id: "tt0903747", tvdb_id: 81189, title: "Breaking Bad", year: 2008, title_type: "tvSeries", source_title: MOM_LIST },
  { imdb_id: "tt0903747", tvdb_id: 81189, title: "Breaking Bad", year: 2008, title_type: "tvSeries", source_title: KID_LIST },
  { imdb_id: "tt8888888", tvdb_id: null, title: "Announced Only", year: null, title_type: "tvSeries", source_title: KID_LIST },
];

function linksDb() {
  return makeDb([
    ["FROM shared_lists WHERE slug = ?", SHARED],
    [
      "f.source_fingerprint",
      {
        results: [
          { id: 7, list_title: MOM_LIST, status: "ready", last_synced_at: RECENT, source_fingerprint: "a", cache_updated_at: RECENT },
          { id: 8, list_title: KID_LIST, status: "ready", last_synced_at: RECENT, source_fingerprint: "b", cache_updated_at: RECENT },
        ],
      },
    ],
    ["JOIN feed_items i", (args) => ({ results: args.includes("movie") ? MOVIES : SHOWS })],
  ]);
}

describe("shared list links", () => {
  test("serve every IMDb list's titles once, each app by the id it adds with", async () => {
    const { env } = makeEnv({ DB: linksDb() });

    const rss = await call(`${ORIGIN}/radarr/s/${SLUG}`, { env });
    assert.equal(rss.response.status, 200);
    assert.equal(rss.text.match(/<item>/g).length, 3, "Shawshank is on both lists and served once");
    assert.match(rss.text, /IMDb ID: tt0111161 \| Type: movie \| Source: Mom's watchlist/);
    assert.match(rss.text, /<atom:link href="https:\/\/imdbwatcharr\.pages\.dev\/radarr\/s\/0123456789ab"/);

    const sonarr = await call(`${ORIGIN}/sonarr/s/${SLUG}`, { env });
    assert.deepEqual(sonarr.parsed, [{ Title: "Breaking Bad", TvdbId: 81189 }]);

    const movies = await call(`${ORIGIN}/radarr/s/${SLUG}/api/v3/movie`, { env });
    assert.deepEqual(
      movies.parsed.map((movie) => movie.tmdbId),
      [278, 27205],
      "a movie without a TMDB id waits; a duplicate counts once",
    );

    const series = await call(`${ORIGIN}/sonarr/s/${SLUG}/api/v3/series`, { env });
    assert.deepEqual(
      series.parsed.map((show) => show.tvdbId),
      [81189],
    );
  });
});

// The person who made the list is sub-mom; sub-kid joined it with the invite.
const AS_MEMBER = {
  id: 3,
  slug: SLUG,
  invite_code: INVITE,
  name: "Family",
  owner_sub: "sub-mom",
  member_id: 12,
  source_count: 1,
};

function viewDb() {
  return makeDb([
    ["WHERE l.slug = ? AND m.member_sub = ?", AS_MEMBER],
    ["WHERE m.member_sub = ? ORDER BY l.created_at", { results: [AS_MEMBER] }],
    [
      "SELECT id, shared_list_id, member_sub, member_name FROM shared_list_members",
      {
        results: [
          { id: 11, shared_list_id: 3, member_sub: "sub-mom", member_name: "Mom" },
          { id: 12, shared_list_id: 3, member_sub: "sub-kid", member_name: "Kid" },
        ],
      },
    ],
    [
      "SELECT s.shared_list_id, s.added_by_sub",
      {
        results: [
          {
            shared_list_id: 3,
            added_by_sub: "sub-mom",
            slug: "abcdef012345",
            source_url: "https://www.imdb.com/user/ur1234/watchlist/",
            list_title: MOM_LIST,
            status: "ready",
            item_count: 2,
            last_synced_at: RECENT,
            last_error: null,
            consecutive_failures: 0,
          },
        ],
      },
    ],
    ["COUNT(DISTINCT", { results: [{ shared_list_id: 3, movies: 2, shows: 1 }] }],
  ]);
}

async function asPerson(sub, name, path, options = {}) {
  const DB = viewDb();
  const { env } = makeEnv({ DB, SESSION_SECRET });
  const result = await call(`${ORIGIN}${path}`, { ...options, env, headers: { cookie: await sessionCookie(sub, name) } });
  return { ...result, DB };
}

describe("shared list page API", () => {
  test("only the person who made it sees the join link, and nobody's sign-in id is sent", async () => {
    const kid = await asPerson("sub-kid", "Kid", "/api/shared");
    const [kidView] = kid.parsed.lists;
    assert.equal(kidView.inviteUrl, null);
    assert.equal(kidView.owner, false);
    assert.deepEqual(kidView.sources.map((source) => [source.addedBy, source.removable]), [["Mom", false]]);
    assert.deepEqual(kidView.members.map((member) => [member.name, member.owner, member.you]), [
      ["Mom", true, false],
      ["Kid", false, true],
    ]);
    assert.equal(kidView.radarrUrl, `${ORIGIN}/radarr/s/${SLUG}`);
    assert.ok(!kid.text.includes("sub-"), "sign-in ids stay in the Worker");

    const mom = await asPerson("sub-mom", "Mom", "/api/shared");
    assert.equal(mom.parsed.lists[0].inviteUrl, `${ORIGIN}/?join=${INVITE}`);
    assert.equal(mom.parsed.lists[0].sources[0].removable, true);
  });

  // The owner-only actions share one guard (delete stands for invite and
  // rename); removing someone else has its own.
  for (const [action, body] of [
    ["delete", {}],
    ["members/remove", { memberId: 11 }],
  ]) {
    test(`someone who only joined cannot ${action} it: 403, and nothing is written`, async () => {
      const { response, DB } = await asPerson("sub-kid", "Kid", `/api/shared/${SLUG}/${action}`, { method: "POST", body });

      assert.equal(response.status, 403);
      assert.deepEqual(
        DB.calls.filter((entry) => entry.kind === "batch" || entry.kind === "run").map((entry) => entry.sql),
        [],
      );
    });
  }

  test("signed out, changing a shared list is refused", async () => {
    const { env } = makeEnv({ DB: viewDb(), SESSION_SECRET });
    const { response, parsed } = await call(`${ORIGIN}/api/shared/${SLUG}/delete`, { method: "POST", body: {}, env });

    assert.equal(response.status, 401);
    assert.deepEqual(parsed, { error: "Sign in first." });
  });
});
