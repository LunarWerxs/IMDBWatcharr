// The two shapes IMDb actually issues: an obfuscated profile id, or a legacy
// user id. Accepting anything looser let `/p/profile-id` and `/p/<slug>.xml`
// create feed rows for lists that cannot exist, which then failed on every
// single sync run forever.
const WATCHLIST_KEY = String.raw`(?:p\.[a-z0-9]+|ur\d+)`;
const LIST_URL_RE = /^https?:\/\/(?:www\.)?imdb\.com\/list\/(ls\d+)(?:\/)?(?:[?#].*)?$/i;
const WATCHLIST_URL_RE = new RegExp(
  String.raw`^https?://(?:www\.)?imdb\.com/user/(${WATCHLIST_KEY})/watchlist(?:/)?(?:[?#].*)?$`,
  "i",
);

export const MOVIE_TITLE_TYPES = new Set(["movie", "tvMovie"]);
export const SERIES_TITLE_TYPES = new Set(["tvSeries", "tvMiniSeries"]);
const ORIGIN_PLACEHOLDER = "__IMDBWATCHARR_PUBLIC_ORIGIN__";

export function normalizeImdbUrl(input) {
  const url = new URL(String(input).trim());
  const href = url.toString();
  const listMatch = href.match(LIST_URL_RE);
  if (listMatch) {
    return {
      canonicalUrl: `https://www.imdb.com/list/${listMatch[1]}/`,
      sourceKind: "list",
      sourceKey: listMatch[1],
    };
  }

  const watchlistMatch = href.match(WATCHLIST_URL_RE);
  if (watchlistMatch) {
    return {
      canonicalUrl: `https://www.imdb.com/user/${watchlistMatch[1]}/watchlist/`,
      sourceKind: "watchlist",
      sourceKey: watchlistMatch[1],
    };
  }

  throw new Error("That link is not a public IMDb list or watchlist. Check it and try again.");
}

function buildSourceFeedPath(normalized) {
  if (normalized.sourceKind === "watchlist") {
    return `/p/${normalized.sourceKey}`;
  }

  if (normalized.sourceKind === "list") {
    return `/l/${normalized.sourceKey}`;
  }

  throw new Error("Unsupported IMDb source type.");
}

export function buildPublicFeedPath(normalized, feedTarget = "radarr") {
  const sourcePath = buildSourceFeedPath(normalized);
  if (feedTarget === "radarr") {
    return `/radarr${sourcePath}`;
  }

  if (feedTarget === "sonarr") {
    return `/sonarr${sourcePath}`;
  }

  throw new Error("Unsupported feed target.");
}

export function getNormalizedFromStoredFeed(feed) {
  return normalizeImdbUrl(feed.source_url);
}

export function parseFeedRoute(pathname) {
  const targetedWatchlistMatch = pathname.match(new RegExp(String.raw`^/(radarr|sonarr)/p/(${WATCHLIST_KEY})/?$`, "i"));
  if (targetedWatchlistMatch) {
    const [, feedTarget, sourceKey] = targetedWatchlistMatch;
    return {
      feedTarget: feedTarget.toLowerCase(),
      canonicalUrl: `https://www.imdb.com/user/${sourceKey}/watchlist/`,
      sourceKind: "watchlist",
      sourceKey,
    };
  }

  const targetedListMatch = pathname.match(/^\/(radarr|sonarr)\/l\/(ls\d+)\/?$/i);
  if (targetedListMatch) {
    const [, feedTarget, sourceKey] = targetedListMatch;
    return {
      feedTarget: feedTarget.toLowerCase(),
      canonicalUrl: `https://www.imdb.com/list/${sourceKey}/`,
      sourceKind: "list",
      sourceKey,
    };
  }

  const watchlistMatch = pathname.match(new RegExp(String.raw`^/p/(${WATCHLIST_KEY})/?$`, "i"));
  if (watchlistMatch) {
    return {
      feedTarget: "radarr",
      canonicalUrl: `https://www.imdb.com/user/${watchlistMatch[1]}/watchlist/`,
      sourceKind: "watchlist",
      sourceKey: watchlistMatch[1],
    };
  }

  const listMatch = pathname.match(/^\/l\/(ls\d+)\/?$/i);
  if (listMatch) {
    return {
      feedTarget: "radarr",
      canonicalUrl: `https://www.imdb.com/list/${listMatch[1]}/`,
      sourceKind: "list",
      sourceKey: listMatch[1],
    };
  }

  const targetedGenericMatch = pathname.match(new RegExp(String.raw`^/(radarr|sonarr)/f/(ls\d+|${WATCHLIST_KEY})/?$`, "i"));
  if (targetedGenericMatch) {
    const [, feedTarget, value] = targetedGenericMatch;
    if (/^ls\d+$/i.test(value)) {
      return {
        feedTarget: feedTarget.toLowerCase(),
        canonicalUrl: `https://www.imdb.com/list/${value}/`,
        sourceKind: "list",
        sourceKey: value,
      };
    }

    return {
      feedTarget: feedTarget.toLowerCase(),
      canonicalUrl: `https://www.imdb.com/user/${value}/watchlist/`,
      sourceKind: "watchlist",
      sourceKey: value,
    };
  }

  const genericMatch = pathname.match(new RegExp(String.raw`^/f/(ls\d+|${WATCHLIST_KEY})/?$`, "i"));
  if (genericMatch) {
    const value = genericMatch[1];
    if (/^ls\d+$/i.test(value)) {
      return {
        feedTarget: "radarr",
        canonicalUrl: `https://www.imdb.com/list/${value}/`,
        sourceKind: "list",
        sourceKey: value,
      };
    }

    return {
      feedTarget: "radarr",
      canonicalUrl: `https://www.imdb.com/user/${value}/watchlist/`,
      sourceKind: "watchlist",
      sourceKey: value,
    };
  }

  return null;
}

export function filterItemsForTarget(items, feedTarget = "radarr") {
  const getTitleType = (item) => item.titleType ?? item.title_type ?? "unknown";

  if (feedTarget === "radarr") {
    return items.filter((item) => MOVIE_TITLE_TYPES.has(getTitleType(item)));
  }

  if (feedTarget === "sonarr") {
    return items.filter((item) => SERIES_TITLE_TYPES.has(getTitleType(item)));
  }

  throw new Error("Unsupported feed target.");
}

export function summarizeItemsByTarget(items) {
  return {
    radarr: filterItemsForTarget(items, "radarr").length,
    sonarr: filterItemsForTarget(items, "sonarr").length,
    total: items.length,
  };
}

export function buildSonarrCustomListPayload(items) {
  return filterItemsForTarget(items, "sonarr")
    .filter((item) => Number.isInteger(item.tvdb_id) && item.tvdb_id > 0)
    .map((item) => ({
      Title: item.title,
      TvdbId: item.tvdb_id,
    }));
}

export async function createStableSlug(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 12);
}

export async function hashText(text, length = 64) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, length);
}

export function buildFeedXml(origin, feed, items, feedTarget = "radarr") {
  const escapeXml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const cdata = (value) => `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
  const feedUrl = `${origin}${buildPublicFeedPath(getNormalizedFromStoredFeed(feed), feedTarget)}`;
  const lastBuildDate = feed.last_synced_at ? new Date(feed.last_synced_at).toUTCString() : new Date().toUTCString();
  const sourceTitle = feed.list_title || "IMDb Feed";
  const libraryName = feedTarget === "sonarr" ? "Sonarr" : "Radarr";
  const feedTitle = `${sourceTitle} (${libraryName})`;
  const description = `${sourceTitle} on IMDb | ${items.length} included for ${libraryName}`;

  const itemXml = items
    .map((item) => {
      const titleWithYear = item.year ? `${item.title} (${item.year})` : item.title;
      const pubDate = item.added_at ? `\n      <pubDate>${new Date(item.added_at).toUTCString()}</pubDate>` : "";
      return `    <item>
      <title>${cdata(titleWithYear)}</title>
      <guid isPermaLink="false">${escapeXml(item.imdb_id)}</guid>
      <link>${escapeXml(`https://www.imdb.com/title/${item.imdb_id}/`)}</link>
      <description>${cdata(`IMDb ID: ${item.imdb_id} | Type: ${item.title_type} | Source: ${sourceTitle}`)}</description>${pubDate}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${cdata(feedTitle)}</title>
    <description>${cdata(description)}</description>
    <link>${escapeXml(feed.source_url)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${itemXml}
  </channel>
</rss>
`;
}

export function buildCachedFeedXmlTemplate(feed, items, feedTarget = "radarr") {
  return buildFeedXml(ORIGIN_PLACEHOLDER, feed, items, feedTarget);
}

export function injectPublicOrigin(template, origin) {
  return String(template).replaceAll(ORIGIN_PLACEHOLDER, origin);
}
