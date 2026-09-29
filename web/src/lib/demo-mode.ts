// The signed-in demo: /?demo shows the page as a signed-in person sees it
// (their lists, shared lists, a join link, the alert bell) with made-up people
// and no account. lib/demo.ts answers the page's account calls in the browser;
// nothing it does reaches anyone's account. This file is only the switch, so
// the page's first download carries none of the demo.

export const DEMO_PARAM = 'demo'

/** The demo's home page. */
export const DEMO_URL = `/?${DEMO_PARAM}`

// The join code of a shared list the demo person has not joined yet ("Game night").
export const DEMO_GAME_NIGHT_INVITE = 'feedfacecafebeefdeadbeef00000001'

/** That list's join link, to see the invite screen in the demo. */
export const DEMO_INVITE_URL = `/?${DEMO_PARAM}&join=${DEMO_GAME_NIGHT_INVITE}`

/** True on a page opened with ?demo. False on the server, where there is no address. */
export function inDemo(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has(DEMO_PARAM)
}
