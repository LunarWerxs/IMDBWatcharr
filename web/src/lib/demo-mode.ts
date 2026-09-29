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

// The signed-in layouts the demo can show, while one is chosen: 1 is the
// page as it ships, 2 and 3 are redesigns (home-v2.tsx, home-v3.tsx).
export const DEMO_LAYOUTS = [
  { layout: 1, name: 'As it is' },
  { layout: 2, name: 'Rows that open' },
  { layout: 3, name: 'Library' },
] as const

export type DemoLayout = (typeof DEMO_LAYOUTS)[number]['layout']

/** Which layout ?demo=N asks for; 1 for a bare ?demo or anything else. */
export function demoLayout(): DemoLayout {
  const asked = Number(new URLSearchParams(window.location.search).get(DEMO_PARAM))
  return DEMO_LAYOUTS.find((entry) => entry.layout === asked)?.layout ?? 1
}
