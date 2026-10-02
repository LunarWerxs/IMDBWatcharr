// Shared lists: one Radarr link and one Sonarr link fed by several IMDb lists,
// which several signed-in people can add to. A household sets the two links up
// in its Radarr and Sonarr once; each person keeps their own IMDb watchlist and
// adds it here, and the links serve every list's titles, each title once.
//
// Making one, adding to one and joining one all need a sign-in. The two links
// themselves are read by Radarr and Sonarr without one, like every other link
// on the site. The join link carries a separate secret, so handing out the
// Radarr link never lets anybody in.

import { arrJson, arrListRequest, arrListResponse } from "./arr-api.js";
import { getSession } from "./auth.js";
import { json } from "./http.js";
import {
  buildSharedFeedPath,
  buildSharedFeedXml,
  buildSonarrCustomListPayload,
  hashText,
  isFeedAlerting,
  normalizeImdbUrl,
  parseSharedFeedRoute,
  uniqueBy,
} from "./imdb.js";
import {
  addSharedSource,
  countOwnedSharedLists,
  createSharedList,
  deleteSharedList,
  getOrCreateFeed,
  getSharedListByInvite,
  getSharedListBySlug,
  getSharedListForMember,
  isStale,
  joinSharedList,
  readSharedItems,
  readSharedListsFor,
  readSharedSourceFeeds,
  removeSharedMember,
  removeSharedSource,
  renameSharedList,
  requestRefresh,
  resetSharedInvite,
} from "./store.js";
import { requestSyncRun, requestSyncRunAfterResponse } from "./sync.js";

// Every IMDb list in a shared list is read about every fifteen minutes, so the
// limits keep one person from putting the sync job's whole run on their lists.
export const MAX_OWNED_SHARED_LISTS = 10;
export const MAX_SOURCES_PER_SHARED_LIST = 25;
export const MAX_MEMBERS_PER_SHARED_LIST = 20;
const NAME_MAX_LENGTH = 60;

const INVITE_CODE = /^[a-f0-9]{32}$/;
const FEED_SLUG = /^[a-f0-9]{12}$/;

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requireSession(session) {
  if (!session) {
    throw new ApiError("Sign in first.", 401);
  }
  return session;
}

function cleanName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
  if (!name) {
    throw new ApiError("Give the shared list a name.");
  }
  return name;
}

function joinUrl(publicOrigin, inviteCode) {
  return `${publicOrigin}/?join=${inviteCode}`;
}

/** One shared list as the page shows it. Nobody's sign-in id leaves the Worker. */
function sharedListView(list, rows, sub, publicOrigin) {
  const owner = list.owner_sub === sub;
  const members = rows.members.filter((member) => member.shared_list_id === list.id);
  const nameOf = new Map(members.map((member) => [member.member_sub, member.member_name]));
  const counts = rows.counts.find((count) => count.shared_list_id === list.id);

  return {
    slug: list.slug,
    name: list.name,
    owner,
    radarrUrl: `${publicOrigin}${buildSharedFeedPath(list.slug, "radarr")}`,
    sonarrUrl: `${publicOrigin}${buildSharedFeedPath(list.slug, "sonarr")}`,
    // Only the person who made it hands out the way in.
    inviteUrl: owner ? joinUrl(publicOrigin, list.invite_code) : null,
    movieCount: counts?.movies ?? 0,
    showCount: counts?.shows ?? 0,
    members: members.map((member) => ({
      id: member.id,
      name: member.member_name || null,
      owner: member.member_sub === list.owner_sub,
      you: member.member_sub === sub,
    })),
    sources: rows.sources
      .filter((source) => source.shared_list_id === list.id)
      .map((source) => ({
        slug: source.slug,
        sourceUrl: source.source_url,
        listTitle: source.list_title || "",
        status: source.status,
        itemCount: source.item_count,
        lastSyncedAt: source.last_synced_at ?? null,
        lastError: source.last_error ?? null,
        consecutiveFailures: source.consecutive_failures ?? 0,
        alerting: isFeedAlerting(source.consecutive_failures),
        addedBy: nameOf.get(source.added_by_sub) ?? null,
        yours: source.added_by_sub === sub,
        removable: owner || source.added_by_sub === sub,
      })),
  };
}

/** Every change answers with all of the person's shared lists, so the page just swaps them in. */
async function listsResponse(env, sub, publicOrigin, extra = {}) {
  const rows = await readSharedListsFor(env.DB, sub);
  return json({ lists: rows.lists.map((list) => sharedListView(list, rows, sub, publicOrigin)), ...extra });
}

async function readBody(request) {
  return request.json().catch(() => ({}));
}

/**
 * A list new to the site is born queued; one that has not been read lately is
 * queued now. Either way the sync job is asked to run, so the shared links fill
 * in within about a minute. After that, being in a shared list keeps it on the
 * fifteen-minute schedule (readSyncTargets in src/store.js).
 */
async function queueRead(env, ctx, feed) {
  if (!feed.created && (feed.refresh_requested_at || !isStale(feed))) {
    return false;
  }
  const refresh = await requestRefresh(env.DB, feed);
  return (feed.created || refresh.queued) && requestSyncRunAfterResponse(env, ctx);
}

// ── Page API ─────────────────────────────────────────────────────────────────

async function listShared({ env, session, publicOrigin }) {
  return session ? listsResponse(env, session.sub, publicOrigin) : json({ lists: [] });
}

/**
 * The IMDb lists a new shared list starts with (the home page's "Combine"),
 * each once. Every link is checked before anything is made, so one bad link
 * makes nothing and says which it was.
 */
function startingSources(value) {
  const urls = Array.isArray(value) ? value.map((url) => String(url ?? "").trim()).filter(Boolean) : [];
  const sources = new Map();
  for (const url of urls) {
    let normalized;
    try {
      normalized = normalizeImdbUrl(url);
    } catch {
      throw new ApiError(`"${url}" is not a public IMDb list or watchlist link.`);
    }
    sources.set(normalized.canonicalUrl, normalized);
  }
  if (sources.size > MAX_SOURCES_PER_SHARED_LIST) {
    throw new ApiError(`A shared list can hold up to ${MAX_SOURCES_PER_SHARED_LIST} IMDb lists.`);
  }
  return [...sources.values()];
}

async function createShared({ request, env, ctx, session, publicOrigin }) {
  const { sub, name: memberName } = requireSession(session);
  const payload = await readBody(request);
  const name = cleanName(payload?.name);
  const sources = startingSources(payload?.sourceUrls);
  if ((await countOwnedSharedLists(env.DB, sub)) >= MAX_OWNED_SHARED_LISTS) {
    throw new ApiError(`You can make up to ${MAX_OWNED_SHARED_LISTS} shared lists. Delete one to make another.`);
  }
  const slug = await createSharedList(env.DB, { name, sub, memberName });
  if (sources.length > 0) {
    const list = await getSharedListForMember(env.DB, slug, sub);
    // One at a time on purpose: the lists keep the order they were typed in, and at most one of them may claim the once-a-minute sync dispatch.
    for (const normalized of sources) {
      const feed = await getOrCreateFeed(env.DB, normalized);
      await addSharedSource(env.DB, list.id, feed.id, sub);
      await queueRead(env, ctx, feed);
    }
  }
  return listsResponse(env, sub, publicOrigin, { slug });
}

async function previewInvite({ env, session, params: [code] }) {
  const list = await getSharedListByInvite(env.DB, code);
  if (!list) {
    throw new ApiError("This invite link does not work any more. Ask for a new one.", 404);
  }
  const joined = Boolean(session) && Boolean(await getSharedListForMember(env.DB, list.slug, session.sub));
  return json({
    name: list.name,
    ownerName: list.owner_name || null,
    sourceCount: list.source_count,
    memberCount: list.member_count,
    joined,
  });
}

async function joinShared({ request, env, session, publicOrigin }) {
  const { sub, name: memberName } = requireSession(session);
  const payload = await readBody(request);
  const code = String(payload?.code ?? "").toLowerCase();
  const list = INVITE_CODE.test(code) ? await getSharedListByInvite(env.DB, code) : null;
  if (!list) {
    throw new ApiError("This invite link does not work any more. Ask for a new one.", 404);
  }
  if (!(await getSharedListForMember(env.DB, list.slug, sub))) {
    if (list.member_count >= MAX_MEMBERS_PER_SHARED_LIST) {
      throw new ApiError(`"${list.name}" already has ${MAX_MEMBERS_PER_SHARED_LIST} people in it.`);
    }
    await joinSharedList(env.DB, list.id, sub, memberName);
  }
  return listsResponse(env, sub, publicOrigin, { slug: list.slug });
}

async function addSource({ request, env, ctx, list, session }) {
  const payload = await readBody(request);
  const normalized = normalizeImdbUrl(payload?.sourceUrl ?? "");
  if (list.source_count >= MAX_SOURCES_PER_SHARED_LIST) {
    throw new ApiError(`A shared list can hold up to ${MAX_SOURCES_PER_SHARED_LIST} IMDb lists.`);
  }
  const feed = await getOrCreateFeed(env.DB, normalized);
  if (!(await addSharedSource(env.DB, list.id, feed.id, session.sub))) {
    throw new ApiError(`That IMDb list is already in "${list.name}".`, 409);
  }
  return { dispatched: await queueRead(env, ctx, feed) };
}

async function removeSource({ request, env, list, owner, session }) {
  const payload = await readBody(request);
  const feedSlug = String(payload?.feedSlug ?? "");
  // Anyone can take out what they added; the person who made the list can take out anything.
  const removed = FEED_SLUG.test(feedSlug) && (await removeSharedSource(env.DB, list.id, feedSlug, owner ? null : session.sub));
  if (!removed) {
    throw new ApiError("You can only remove the lists you added.", 403);
  }
}

async function removeMember({ request, env, list, owner }) {
  const payload = await readBody(request);
  const memberId = Number(payload?.memberId);
  if (!Number.isInteger(memberId)) {
    throw new ApiError("Say who to remove.");
  }
  const leaving = memberId === list.member_id;
  if (leaving && owner) {
    throw new ApiError("You made this shared list, so delete it rather than leave it.");
  }
  if (!leaving && !owner) {
    throw new ApiError("Only the person who made this shared list can remove people.", 403);
  }
  await removeSharedMember(env.DB, list.id, memberId);
}

function ownerOnly(action) {
  return async (context) => {
    if (!context.owner) {
      throw new ApiError("Only the person who made this shared list can do that.", 403);
    }
    return action(context);
  };
}

const MEMBER_ACTIONS = {
  sources: addSource,
  "sources/remove": removeSource,
  "members/remove": removeMember,
  invite: ownerOnly(({ env, list }) => resetSharedInvite(env.DB, list.id)),
  rename: ownerOnly(async ({ request, env, list }) => renameSharedList(env.DB, list.id, cleanName((await readBody(request))?.name))),
  delete: ownerOnly(({ env, list }) => deleteSharedList(env.DB, list.id)),
};

async function actOnShared(context) {
  const { env, session, publicOrigin, params: [slug, action] } = context;
  const { sub } = requireSession(session);
  const list = await getSharedListForMember(env.DB, slug, sub);
  if (!list) {
    throw new ApiError("There is no such shared list, or you are not in it.", 404);
  }
  if (!Object.hasOwn(MEMBER_ACTIONS, action)) {
    throw new ApiError("There is no such action on a shared list.", 404);
  }
  const extra = await MEMBER_ACTIONS[action]({ ...context, list, owner: list.owner_sub === sub });
  return listsResponse(env, sub, publicOrigin, extra ?? {});
}

const SHARED_API_ROUTES = [
  ["GET", /^\/api\/shared$/, listShared],
  ["POST", /^\/api\/shared$/, createShared],
  ["GET", /^\/api\/shared\/invite\/([a-f0-9]{32})$/, previewInvite],
  ["POST", /^\/api\/shared\/join$/, joinShared],
  ["POST", /^\/api\/shared\/([a-f0-9]{12})\/(sources|sources\/remove|members\/remove|invite|rename|delete)$/, actOnShared],
];

async function handleSharedApiRoute(context) {
  const { request, env, url } = context;
  if (!url.pathname.startsWith("/api/shared")) {
    return null;
  }

  const route = SHARED_API_ROUTES.find(([method, pattern]) => request.method === method && pattern.test(url.pathname));
  if (!route) {
    return null;
  }

  const [, pattern, handle] = route;
  try {
    const session = await getSession(request, env);
    return await handle({ ...context, session, params: url.pathname.match(pattern).slice(1) });
  } catch (error) {
    return json({ error: error.message }, { status: error.status ?? 400 });
  }
}

// ── The two links ────────────────────────────────────────────────────────────

const SHARED_ARR_API_ROUTE = /^(\/(?:radarr|sonarr)\/s\/[a-f0-9]{12})\/api\/v3\/([a-z]+)\/?$/i;

const FEED_CONTENT_TYPES = {
  radarr: "application/rss+xml; charset=utf-8",
  sonarr: "application/json; charset=utf-8",
};

function textResponse(body, status, headers = {}) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });
}

const NO_SUCH_SHARED_LIST =
  "This shared list does not exist on Watcharr any more. Whoever made it may have deleted it.";

// The lists are on the schedule already; this only catches one the schedule
// has fallen behind on, the way a single list's poll does.
function nudgeStaleSources(env, ctx, sources) {
  const stale = sources.filter((feed) => isStale(feed) && !feed.refresh_requested_at);
  if (stale.length === 0) {
    return;
  }
  ctx.waitUntil(
    Promise.all(stale.map((feed) => requestRefresh(env.DB, feed)))
      .then((refreshes) => (refreshes.some((refresh) => refresh.queued) ? requestSyncRun(env) : null))
      .catch(() => {
        // Only a hurry-up for a read the schedule makes anyway.
      }),
  );
}

// Radarr and Sonarr log this body, so it says what is happening.
function notReadYet() {
  return textResponse(
    "None of the IMDb lists in this shared list has been read yet. The next sync run, within a few minutes, will read them.",
    503,
    { "retry-after": "900" },
  );
}

/**
 * The shared list and where each of its IMDb lists stands, or the response
 * that answers instead: no such list, or nothing read yet. An empty shared
 * list is not an error: it serves an empty list until someone adds to it.
 */
async function loadShared(env, ctx, slug, notFound) {
  const shared = await getSharedListBySlug(env.DB, slug);
  if (!shared) {
    return { response: notFound };
  }
  const sources = await readSharedSourceFeeds(env.DB, shared.id);
  nudgeStaleSources(env, ctx, sources);
  if (sources.length > 0 && sources.every((feed) => !feed.last_synced_at)) {
    return { response: notReadYet() };
  }
  return { shared, sources };
}

// Changes when the lists in it change, or any of them is read with something new.
async function sharedEtag(shared, sources, feedTarget) {
  const state = [
    shared.updated_at,
    ...sources.map((feed) => `${feed.id}:${feed.source_fingerprint ?? ""}:${feed.cache_updated_at ?? ""}`),
  ].join("|");
  return `"s-${await hashText(state, 24)}-${feedTarget}"`;
}

function hasFreshEtag(request, etag) {
  const ifNoneMatch = request.headers.get("if-none-match");
  return Boolean(ifNoneMatch) && ifNoneMatch.split(",").some((value) => value.trim().replace(/^W\//, "") === etag);
}

function latestRead(sources) {
  return sources.map((feed) => feed.last_synced_at).filter(Boolean).sort().at(-1) ?? null;
}

async function sharedFeedBody(env, shared, sources, feedTarget, publicOrigin) {
  const items = uniqueBy(await readSharedItems(env.DB, shared.id, feedTarget), "imdb_id");
  if (feedTarget === "sonarr") {
    return JSON.stringify(uniqueBy(buildSonarrCustomListPayload(items), "TvdbId"));
  }
  return buildSharedFeedXml(publicOrigin, shared, items, latestRead(sources));
}

async function handleSharedFeedRoute({ request, env, ctx, url, publicOrigin }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }
  const route = parseSharedFeedRoute(url.pathname);
  if (!route) {
    return null;
  }

  const { shared, sources, response } = await loadShared(env, ctx, route.slug, textResponse(NO_SUCH_SHARED_LIST, 404));
  if (response) {
    return response;
  }

  const etag = await sharedEtag(shared, sources, route.feedTarget);
  const headers = { "cache-control": "public, max-age=300", etag, "x-robots-tag": "noindex" };
  if (hasFreshEtag(request, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(await sharedFeedBody(env, shared, sources, route.feedTarget, publicOrigin), {
    headers: { "content-type": FEED_CONTENT_TYPES[route.feedTarget], ...headers },
  });
}

async function handleSharedArrApiRoute({ request, env, ctx, url }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }
  const match = url.pathname.match(SHARED_ARR_API_ROUTE);
  const route = match && parseSharedFeedRoute(match[1]);
  if (!route) {
    return null;
  }

  const { feedTarget } = route;
  const listRequest = arrListRequest(feedTarget, match[2]);
  if (listRequest.response) {
    return listRequest.response;
  }

  const { shared, response } = await loadShared(env, ctx, route.slug, arrJson({ message: NO_SUCH_SHARED_LIST }, 404));
  if (response) {
    return response;
  }

  // The app adds by TMDB id (movies) or TVDB id (shows), so a title still
  // without one waits, and two IMDb entries for one title count once.
  const idKey = feedTarget === "radarr" ? "tmdb_id" : "tvdb_id";
  const items = (await readSharedItems(env.DB, shared.id, feedTarget)).filter((item) => item[idKey] > 0);
  const rows = uniqueBy(items, idKey).map((item) => ({ id: item[idKey], title: item.title, year: item.year }));
  return arrListResponse(feedTarget, rows);
}

export const SHARED_ROUTE_HANDLERS = [handleSharedApiRoute, handleSharedArrApiRoute, handleSharedFeedRoute];
