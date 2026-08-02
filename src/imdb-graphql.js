// IMDb's own GraphQL API, which is what imdb.com itself talks to.
//
// This replaced HTML scraping. The rendered pages are behind a bot challenge and
// the Browser Rendering fallback ran out of quota, so every refresh failed from
// April 2026 onward while the routes quietly served the last good snapshot.
// This endpoint answers the same question directly, with no browser involved.

const IMDB_GRAPHQL_ENDPOINT = "https://api.graphql.imdb.com/";

// Without x-imdb-client-name the endpoint answers a bare nginx 403 with no JSON
// body at all, so it is not optional.
const IMDB_GRAPHQL_HEADERS = {
  "content-type": "application/json",
  accept: "application/json",
  "x-imdb-client-name": "imdb-web-next",
};

// The server caps a page at 250 no matter what `first` asks for: a 1000-title
// list still answers 250 edges with hasNextPage true. Paging is mandatory.
const PAGE_SIZE = 250;

// A guard against a pageInfo that never terminates. 40 pages is 10,000 titles,
// far past any real list, so hitting it means something is wrong.
const MAX_PAGES = 40;

const LIST_METADATA_FIELDS = `
  id
  name { originalText }
  lastModifiedDate
  author { userId username { text } }`;

const LIST_ITEM_FIELDS = `
  total
  pageInfo { hasNextPage endCursor }
  edges {
    node { absolutePosition createdDate }
    title {
      id
      titleText { text }
      originalTitleText { text }
      titleType { id }
      releaseYear { year }
    }
  }`;

// LIST_ORDER/ASC is the order the list page itself shows, and pinning it keeps
// the fingerprint stable rather than at the mercy of a default that may change.
const LIST_QUERY = `query ImdbList($id: ID!, $first: Int!, $after: String) {
  list(id: $id) {${LIST_METADATA_FIELDS}
    titleListItemSearch(first: $first, after: $after, sort: { by: LIST_ORDER, order: ASC }) {${LIST_ITEM_FIELDS}
    }
  }
}`;

const WATCHLIST_QUERY = `query ImdbWatchlist($userId: ID!, $first: Int!, $after: String) {
  predefinedList(classType: WATCH_LIST, userId: $userId) {${LIST_METADATA_FIELDS}
    titleListItemSearch(first: $first, after: $after, sort: { by: LIST_ORDER, order: ASC }) {${LIST_ITEM_FIELDS}
    }
  }
}`;

// predefinedList only accepts a ur… id, so an obfuscated p.… profile id from a
// watchlist URL has to be translated first.
const PROFILE_QUERY = `query ImdbProfile($profileId: ID!) {
  userProfile(input: { profileId: $profileId }) {
    userId
  }
}`;

// A list that is missing or private is a user-facing answer, not a fault, so it
// carries a message meant to be read rather than one meant to be logged.
export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
  }
}

async function imdbGraphql(query, variables, fetchImpl = fetch) {
  const response = await fetchImpl(IMDB_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: IMDB_GRAPHQL_HEADERS,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`IMDb GraphQL request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    const message = payload.errors[0]?.message ?? "unknown error";

    // A typo'd or private id is the common case here, and IMDb answers it with a
    // Java stack-trace string. Do not put that in front of someone.
    if (/RESOURCE_NOT_FOUND|Not found/i.test(message)) {
      throw new NotFoundError("IMDb has nothing public at that link. It may be private, or the id may be wrong.");
    }

    throw new Error(`IMDb GraphQL error: ${message}`);
  }

  return payload?.data ?? {};
}

async function resolveWatchlistUserId(sourceKey, fetchImpl) {
  if (/^ur\d+$/i.test(sourceKey)) {
    return sourceKey;
  }

  const data = await imdbGraphql(PROFILE_QUERY, { profileId: sourceKey }, fetchImpl);
  const userId = data?.userProfile?.userId;
  if (!userId) {
    throw new NotFoundError(`IMDb has no public profile at ${sourceKey}. Check the watchlist is set to public.`);
  }

  return userId;
}

function mapEdge(edge, index) {
  const title = edge?.title ?? {};
  const node = edge?.node ?? {};
  const imdbId = title?.id;
  if (!imdbId || !/^tt\d+$/.test(imdbId)) {
    return null;
  }

  const year = title?.releaseYear?.year;
  const position = Number(node?.absolutePosition);

  return {
    imdbId,
    title: title?.titleText?.text ?? title?.originalTitleText?.text ?? imdbId,
    year: Number.isFinite(year) ? year : null,
    titleType: title?.titleType?.id ?? "unknown",
    position: Number.isFinite(position) ? position : index + 1,
    addedAt: node?.createdDate ?? null,
  };
}

async function collectListPages(query, baseVariables, rootField, fetchImpl) {
  const items = [];
  // feed_items is keyed on (feed_id, imdb_id) and IMDb lists really do repeat a
  // title, so a duplicate would fail the whole insert batch. Keep the first
  // occurrence, which under LIST_ORDER is the earliest position.
  const seen = new Set();
  let listNode = null;
  let after = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await imdbGraphql(query, { ...baseVariables, first: PAGE_SIZE, after }, fetchImpl);
    const node = data?.[rootField];
    if (!node) {
      return null;
    }

    listNode = node;
    const connection = node?.titleListItemSearch ?? {};
    const edges = Array.isArray(connection.edges) ? connection.edges : [];

    for (const [index, edge] of edges.entries()) {
      const mapped = mapEdge(edge, items.length + index);
      if (mapped && !seen.has(mapped.imdbId)) {
        seen.add(mapped.imdbId);
        items.push(mapped);
      }
    }

    // An empty page that still claims more would loop forever.
    if (!connection?.pageInfo?.hasNextPage || !edges.length || !connection.pageInfo.endCursor) {
      return { listNode, items };
    }

    after = connection.pageInfo.endCursor;
  }

  // Truncating here would silently drop titles from the user's feed. Failing
  // instead keeps the last good snapshot in place, which is the honest outcome.
  throw new Error(`IMDb list did not finish paging after ${MAX_PAGES} pages.`);
}

function buildSnapshot(result, fallbackTitle) {
  const { listNode, items } = result;
  const listTitle = listNode?.name?.originalText || fallbackTitle;

  return {
    parserMode: "graphql",
    sourceTitle: listTitle,
    listTitle,
    listAuthor: listNode?.author?.username?.text ?? "",
    listId: listNode?.id ?? "",
    lastSourceModifiedAt: listNode?.lastModifiedDate ?? null,
    hasNextPage: false,
    totalItems: items.length,
    items,
  };
}

/**
 * Fetch a list or watchlist as the snapshot shape the Worker stores.
 */
export async function fetchImdbList(normalized, fetchImpl = fetch) {
  if (normalized.sourceKind === "list") {
    const result = await collectListPages(LIST_QUERY, { id: normalized.sourceKey }, "list", fetchImpl);
    if (!result) {
      throw new NotFoundError(`IMDb has no public list called ${normalized.sourceKey}.`);
    }

    return buildSnapshot(result, normalized.sourceKey);
  }

  if (normalized.sourceKind === "watchlist") {
    const userId = await resolveWatchlistUserId(normalized.sourceKey, fetchImpl);
    const result = await collectListPages(WATCHLIST_QUERY, { userId }, "predefinedList", fetchImpl);
    if (!result) {
      throw new NotFoundError(`IMDb has no public watchlist for ${normalized.sourceKey}.`);
    }

    return buildSnapshot(result, "Watchlist");
  }

  throw new Error("Unsupported IMDb source type.");
}

/**
 * The stable slice of a snapshot to hash. Anything that moves without the list
 * itself changing has to stay out of this, or every sync rebuilds the caches.
 */
export function buildSnapshotFingerprintPayload(snapshot) {
  return JSON.stringify({
    parserMode: snapshot.parserMode,
    listId: snapshot.listId || null,
    lastModifiedDate: snapshot.lastSourceModifiedAt ?? null,
    total: snapshot.totalItems,
    items: snapshot.items.map((item) => ({
      imdbId: item.imdbId,
      title: item.title,
      year: item.year,
      titleType: item.titleType,
      position: item.position,
      addedAt: item.addedAt,
    })),
  });
}
