// The sync job's runner half.
//
// IMDb refuses every request from Cloudflare's egress (api.graphql.imdb.com and
// caching.graphql.imdb.com both answer 429 "Too many network requests" to a
// Worker, and the list page answers a 202 challenge), so the Worker cannot fetch
// its own data. A GitHub Actions runner can. This script runs there, asks the
// Worker what to read, reads each list from IMDb, and hands the snapshots back
// to /api/ingest. A list with more movies than one request looks up on TMDB is
// finished through /api/resolve-ids.
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

// One origin. The repository variable once listed two (the move to
// lunarwerx.com), and a list here fails as a baffling DNS error on a host
// named "watcharr.lunarwerx.com,https".
if (!/^https?:\/\/[^,\s/]+$/.test(WORKER_ORIGIN)) {
  console.error(`WORKER_ORIGIN must be a single origin such as https://watcharr.lunarwerx.com, got "${WORKER_ORIGIN}".`);
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

async function post(path, body) {
  const response = await fetch(`${WORKER_ORIGIN}${path}`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed with status ${response.status}: ${payload.error ?? "no detail"}`);
  }

  return payload;
}

const postIngest = (body) => post("/api/ingest", body);

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

// Five failures in a row with nothing read means IMDb (or the Worker) is down
// for everyone, not that five lists broke. Stop asking: the rest keep their
// place in the queue, and the red run says what happened.
const OUTAGE_AFTER_FAILURES = 5;
const looksDown = () => succeeded === 0 && failed >= OUTAGE_AFTER_FAILURES;

// A read is mostly waiting: a few GraphQL pages in turn, then the ingest. One
// list at a time left the runner idle for most of a run (18 lists, 45 s), so a
// few are read at once, still far fewer requests than one visit to imdb.com.
const READ_CONCURRENCY = 3;
const seconds = (since) => `${((Date.now() - since) / 1000).toFixed(1)}s`;

// Radarr's own list type keys a movie on its TMDB id, which the Worker looks up
// a few hundred at a time. For a bigger list, ask for the next batch while any
// are left, the count keeps falling (what TMDB cannot answer stays left) and
// the run has time; whatever remains is picked up on the list's next read.
const MAX_RESOLVE_PASSES = 12;

async function resolveRest(sourceUrl, left) {
  for (let pass = 0; left > 0 && pass < MAX_RESOLVE_PASSES && Date.now() - startedAt <= TIME_BUDGET_MS; pass += 1) {
    const { moviesLeft } = await post("/api/resolve-ids", { sourceUrl });
    if (!(moviesLeft < left)) {
      return moviesLeft;
    }
    left = moviesLeft;
  }
  return left;
}

async function readOne({ sourceUrl, owned, requested }) {
  const label = `${owned ? "owned" : "guest"}${requested ? ", requested" : ""}`;
  const began = Date.now();
  try {
    const snapshot = await fetchImdbList(normalizeImdbUrl(sourceUrl));
    const read = seconds(began);
    const ingestBegan = Date.now();
    const result = await postIngest({ sourceUrl, snapshot });
    succeeded += 1;
    // A failed batch is not a failed read: the ids are asked for again next time.
    const left = result.moviesLeft ? await resolveRest(sourceUrl, result.moviesLeft).catch(() => "some") : 0;
    const ids = result.moviesLeft ? `, TMDB ids ${left ? `${left} left` : "all found"}` : "";
    console.log(
      `  ok   ${sourceUrl} (${label}) -> ${snapshot.items.length} items, status ${result.status}${ids} (read ${read}, ingest ${seconds(ingestBegan)})`,
    );
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

// Each reader takes the next list in queue order until the list, the time
// budget or IMDb runs out.
let next = 0;
async function reader() {
  while (next < targets.length && Date.now() - startedAt <= TIME_BUDGET_MS && !looksDown()) {
    await readOne(targets[next++]);
  }
}
await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, targets.length) }, reader));

const deferred = targets.length - next;
if (deferred && looksDown()) {
  console.log(`${failed} reads failed and none worked, so IMDb looks down; ${deferred} left for the next run.`);
} else if (deferred) {
  console.log(`Time budget used; ${deferred} feed${deferred === 1 ? "" : "s"} left for the next run.`);
}

console.log(
  `Done in ${seconds(startedAt)}. ${succeeded} read, ${unavailable} private or missing, ${failed} failed, ${deferred} deferred.`,
);

// A private list is the list owner's to fix, not a fault here. A run where
// every list that should have been readable failed is: IMDb or the Worker is
// down, and the red run is how anyone finds out.
if (failed > 0 && succeeded === 0) {
  process.exit(1);
}
