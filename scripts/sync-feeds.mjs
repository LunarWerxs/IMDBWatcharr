// The sync job's runner half.
//
// IMDb refuses every request from Cloudflare's egress (api.graphql.imdb.com and
// caching.graphql.imdb.com both answer 429 "Too many network requests" to a
// Worker, and the list page answers a 202 challenge), so the Worker cannot fetch
// its own data. A GitHub Actions runner can. This script runs there, asks the
// Worker what to read, reads each list from IMDb, and hands the snapshots back
// to /api/ingest.
//
// Env:
//   WORKER_ORIGIN  the Worker's base URL
//   INGEST_SECRET  shared secret, matching the Worker's own
//   SYNC_SCOPE     "all" (the schedule: every claimed feed plus the queue) or
//                  "requested" (the run a pasted list dispatches: the queue only)

import { NotFoundError, fetchImdbList } from "../src/imdb-graphql.js";
import { normalizeImdbUrl } from "../src/imdb.js";

const WORKER_ORIGIN = (process.env.WORKER_ORIGIN ?? "").trim().replace(/\/+$/, "");
const INGEST_SECRET = process.env.INGEST_SECRET ?? "";
const SYNC_SCOPE = process.env.SYNC_SCOPE === "requested" ? "requested" : "all";

if (!WORKER_ORIGIN || !INGEST_SECRET) {
  console.error("WORKER_ORIGIN and INGEST_SECRET are both required.");
  process.exit(1);
}

const authHeaders = { authorization: `Bearer ${INGEST_SECRET}` };

async function readSyncTargets() {
  const response = await fetch(`${WORKER_ORIGIN}/api/sync-targets?scope=${SYNC_SCOPE}`, { headers: authHeaders });
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

// Record the failure on the feed so the page can say why it is empty or
// stale, rather than letting it age silently. A private or missing list is
// permanent: the Worker stops queueing it until someone asks again.
async function reportFailure(sourceUrl, error) {
  try {
    await postIngest({ sourceUrl, error: error.message, permanent: error instanceof NotFoundError });
  } catch (reportError) {
    console.log(`       (could not record the failure: ${reportError.message})`);
  }
}

const targets = await readSyncTargets();
if (!targets.length) {
  console.log(`${WORKER_ORIGIN}: nothing to sync (${SYNC_SCOPE}).`);
  process.exit(0);
}

console.log(`${WORKER_ORIGIN}: syncing ${targets.length} feed${targets.length === 1 ? "" : "s"} (${SYNC_SCOPE}).`);

// The job's own timeout is 10 minutes. Stopping short of it means a long queue
// is finished by the next run instead of the whole run being killed mid-list:
// the queue is oldest-first and claimed feeds least-recently-synced first, so
// whatever is left over goes first next time.
const TIME_BUDGET_MS = 8 * 60 * 1000;
const startedAt = Date.now();

let succeeded = 0;
let unavailable = 0;
let failed = 0;
let deferred = 0;

for (const { sourceUrl, owned, requested } of targets) {
  if (Date.now() - startedAt > TIME_BUDGET_MS) {
    deferred = targets.length - (succeeded + unavailable + failed);
    console.log(`Time budget used; ${deferred} feed${deferred === 1 ? "" : "s"} left for the next run.`);
    break;
  }

  const label = `${owned ? "owned" : "guest"}${requested ? ", requested" : ""}`;
  try {
    const snapshot = await fetchImdbList(normalizeImdbUrl(sourceUrl));
    const result = await postIngest({ sourceUrl, snapshot });
    succeeded += 1;
    console.log(`  ok   ${sourceUrl} (${label}) -> ${snapshot.items.length} items, status ${result.status}`);
  } catch (error) {
    if (error instanceof NotFoundError) {
      unavailable += 1;
    } else {
      failed += 1;
    }
    console.log(`  fail ${sourceUrl} (${label}) -> ${error.message}`);
    await reportFailure(sourceUrl, error);
  }
}

console.log(`Done. ${succeeded} read, ${unavailable} private or missing, ${failed} failed, ${deferred} deferred.`);

// A private list is the list owner's to fix, not a fault here. A run where
// every list that should have been readable failed is: IMDb or the Worker is
// down, and the red run is how anyone finds out.
if (failed > 0 && succeeded === 0) {
  process.exit(1);
}
