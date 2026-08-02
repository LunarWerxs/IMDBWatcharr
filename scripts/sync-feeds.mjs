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
//   WORKER_ORIGIN   the Worker's base URL
//   INGEST_SECRET   shared secret, matching the Worker's own
//   ONLY_SOURCE_URL optional; sync just this one list (the on-demand dispatch)

import { fetchImdbList } from "../src/imdb-graphql.js";
import { normalizeImdbUrl } from "../src/imdb.js";

const WORKER_ORIGIN = (process.env.WORKER_ORIGIN ?? "").replace(/\/+$/, "");
const INGEST_SECRET = process.env.INGEST_SECRET ?? "";
const ONLY_SOURCE_URL = (process.env.ONLY_SOURCE_URL ?? "").trim();

if (!WORKER_ORIGIN || !INGEST_SECRET) {
  console.error("WORKER_ORIGIN and INGEST_SECRET are both required.");
  process.exit(1);
}

const authHeaders = { authorization: `Bearer ${INGEST_SECRET}` };

async function readSyncTargets() {
  const response = await fetch(`${WORKER_ORIGIN}/api/sync-targets`, { headers: authHeaders });
  if (!response.ok) {
    throw new Error(`Reading sync targets failed with status ${response.status}.`);
  }

  const payload = await response.json();
  return payload.feeds ?? [];
}

async function postIngest(body) {
  const response = await fetch(`${WORKER_ORIGIN}/api/ingest`, {
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

const targets = ONLY_SOURCE_URL ? [{ sourceUrl: ONLY_SOURCE_URL }] : await readSyncTargets();

if (!targets.length) {
  console.log("No feeds to sync.");
  process.exit(0);
}

console.log(`Syncing ${targets.length} feed${targets.length === 1 ? "" : "s"}.`);

let failures = 0;

for (const target of targets) {
  const sourceUrl = target.sourceUrl;
  try {
    const snapshot = await fetchImdbList(normalizeImdbUrl(sourceUrl));
    const result = await postIngest({ sourceUrl, snapshot });
    console.log(`  ok   ${sourceUrl} -> ${snapshot.items.length} items, status ${result.status}`);
  } catch (error) {
    failures += 1;
    console.log(`  fail ${sourceUrl} -> ${error.message}`);

    // Record the failure on the feed so the UI can say why it is stale, rather
    // than letting it age silently. A failure to record is not itself fatal.
    try {
      await postIngest({ sourceUrl, error: error.message });
    } catch (reportError) {
      console.log(`       (could not record the failure: ${reportError.message})`);
    }
  }
}

console.log(`Done. ${targets.length - failures} succeeded, ${failures} failed.`);

// A single unreachable list should not fail the run; every list failing should.
if (failures === targets.length) {
  process.exit(1);
}
