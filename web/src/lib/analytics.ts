// Anonymous visit ping to the Studio web-ping endpoint (the AnatomyOf pattern:
// studio.connections.icu/v1/app/<id>/latest). One fire-and-forget GET per
// browser session. The server derives only coarse geo/network/locale context
// from the request itself (never an IP address) plus what this file sends:
// a random visitor id, the app version, and a referrer hostname. No cookies,
// no user data. Honors Do Not Track / Global Privacy Control, skips
// localhost, and a failure here can never affect the app.

const APP_ID = 'imdbwatch'
const PING_URL = `https://studio.connections.icu/v1/app/${APP_ID}/latest`
const ID_KEY = `${APP_ID}:visitor-id`
const SESSION_KEY = `${APP_ID}:pinged`

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local')
  )
}

export function sendVisitPing(): void {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
    if (nav.doNotTrack === '1' || nav.globalPrivacyControl) return
    if (isLocalHost(window.location.hostname)) return
    if (sessionStorage.getItem(SESSION_KEY)) return
    sessionStorage.setItem(SESSION_KEY, '1')

    // The stored id's mere presence is what marks a visit as not-first, so it
    // must not be written until the ping that reports "new" has actually
    // gone out (see the .then() below) - otherwise a failed first ping would
    // silently and permanently lose the "new" signal.
    const existingId = localStorage.getItem(ID_KEY)
    const firstVisit = !existingId
    const id = existingId ?? crypto.randomUUID()

    const params = new URLSearchParams({ iid: id, v: __APP_VERSION__ })
    if (firstVisit) params.set('new', '1')
    if (document.referrer) {
      try {
        // Hostname only - never the full referrer URL (path/query can carry
        // identifying detail we have no business forwarding).
        params.set('ref', new URL(document.referrer).hostname)
      } catch {
        // malformed referrer: omit rather than send anything unparsed
      }
    }

    // no-cors: the request still reaches the server (that IS the ping); the
    // opaque response can't be read, and no-cors forbids custom headers, so
    // the id rides in the query string instead.
    fetch(`${PING_URL}?${params.toString()}`, { mode: 'no-cors', keepalive: true })
      .then(() => {
        localStorage.setItem(ID_KEY, id)
      })
      .catch(() => {
        // best-effort, no retries within this page load
      })
  } catch {
    // storage/fetch unavailable (private mode, extensions): skip silently
  }
}
