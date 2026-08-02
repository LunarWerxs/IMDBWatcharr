// Cloudflare Pages serves the built SPA from ../pages-static. Only the API and
// the Radarr/Sonarr feed routes belong to the Worker, so everything else falls
// through to the static asset handler via context.next().
const PROXIED_PREFIXES = ["/api/", "/radarr/", "/sonarr/", "/p/", "/l/", "/f/"];

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (!PROXIED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return context.next();
  }

  const headers = new Headers(context.request.headers);
  headers.set("x-public-origin", url.origin);

  return context.env.BACKEND.fetch(new Request(context.request, { headers }));
}
