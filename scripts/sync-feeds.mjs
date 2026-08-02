// The sync job's runner half.
//
// IMDb refuses every request from Cloudflare's egress (api.graphql.imdb.com and
// caching.graphql.imdb.com both answer 429 "Too many network requests" to a
// Worker, and the list page answers a 202 challenge), so the Worker cannot fetch
// its own data. A GitHub Actions runner can: verified 5/5 HTTP 200. This script
// runs there, reads the feed list from the Worker, fetches each list from IMDb,
// and hands the snapshots back to /api/ingest.
//
// Env:
//   WORKER_ORIGIN   the Worker's base URL, or several separated by commas
//                   (both origins are synced during the move to lunarwerx.com,
//                   so feeds already configured in Radarr keep updating)
//   INGEST_SECRET   shared secret, matching the Worker's own
//   ONLY_SOURCE_URL optional; sync just this one list (the on-demand dispatch)

import { fetchImdbList } from "../src/imdb-graphql.js";
import { normalizeImdbUrl } from "../src/imdb.js";

const WORKER_ORIGINS = (process.env.WORKER_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const INGEST_SECRET = process.env.INGEST_SECRET ?? "";
const ONLY_SOURCE_URL = (process.env.ONLY_SOURCE_URL ?? "").trim();

if (!WORKER_ORIGINS.length || !INGEST_SECRET) {
  console.error("WORKER_ORIGIN and INGEST_SECRET are both required.");
  process.exit(1);
}

const authHeaders = { authorization: `Bearer ${INGEST_SECRET}` };

async function readSyncTargets(origin) {
  const response = await fetch(`${origin}/api/sync-targets`, { headers: authHeaders });
  if (!response.ok) {
    throw new Error(`Reading sync targets failed with status ${response.status}.`);
  }

  const payload = await response.json();
  return payload.feeds ?? [];
}

async function postIngest(origin, body) {
  const response = await fetch(`${origin}/api/ingest`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Ingest failed with status ${response.status}: ${payload.error ?? "no detail"}`);
  }

  return payload;
}

// One IMDb fetch can serve several origins, so cache per run rather than asking
// IMDb the same question once per deployment.
const snapshots = new Map();

async function snapshotFor(sourceUrl) {
  if (!snapshots.has(sourceUrl)) {
    snapshots.set(sourceUrl, await fetchImdbList(normalizeImdbUrl(sourceUrl)));
  }
  return snapshots.get(sourceUrl);
}

let attempted = 0;
let failures = 0;

for (const origin of WORKER_ORIGINS) {
  let targets;
  try {
    targets = ONLY_SOURCE_URL ? [{ sourceUrl: ONLY_SOURCE_URL }] : await readSyncTargets(origin);
  } catch (error) {
    // One unreachable deployment must not stop the others.
    console.log(`${origin}: could not read sync targets, skipping (${error.message})`);
    continue;
  }

  if (!targets.length) {
    console.log(`${origin}: nothing to sync.`);
    continue;
  }

  console.log(`${origin}: syncing ${targets.length} feed${targets.length === 1 ? "" : "s"}.`);

  for (const target of targets) {
    const sourceUrl = target.sourceUrl;
    attempted += 1;
    try {
      const snapshot = await snapshotFor(sourceUrl);
      const result = await postIngest(origin, { sourceUrl, snapshot });
      console.log(`  ok   ${sourceUrl} -> ${snapshot.items.length} items, status ${result.status}`);
    } catch (error) {
      failures += 1;
      console.log(`  fail ${sourceUrl} -> ${error.message}`);

      // Record the failure on the feed so the UI can say why it is stale, rather
      // than letting it age silently. A failure to record is not itself fatal.
      try {
        await postIngest(origin, { sourceUrl, error: error.message });
      } catch (reportError) {
        console.log(`       (could not record the failure: ${reportError.message})`);
      }
    }
  }
}

console.log(`Done. ${attempted - failures} succeeded, ${failures} failed.`);

// A single unreachable list should not fail the run; every list failing should.
if (attempted > 0 && failures === attempted) {
  process.exit(1);
}
