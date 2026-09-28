import { lazy, useSyncExternalStore, type ComponentType } from 'react'

const loaders: Array<() => Promise<unknown>> = []

const never = () => () => {}

/**
 * False in the prerender and in the render that hydrates it, true from the
 * render after: for what the prerendered HTML cannot know or does not carry.
 */
export function useHydrated() {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  )
}

// A page whose HTML came from one deploy can ask for a part after the next
// deploy has replaced it, and the old file is gone. Rather than leave the part
// missing (which takes the whole page down), the page reloads onto the new
// build, once per tab until every part has loaded again.
const RELOADED_FOR_PARTS = 'watcharr:reloaded-for-parts'

function reloadOnce(error: unknown): Promise<never> {
  if (sessionStorage.getItem(RELOADED_FOR_PARTS)) throw error
  sessionStorage.setItem(RELOADED_FOR_PARTS, '1')
  window.location.reload()
  return new Promise<never>(() => {})
}

/**
 * A part of the page nobody sees on arrival (the title popup, the filled-in
 * result, the toasts, the signed-in extras), split out of the first download.
 * It is not left to load on first use: preloadParts fetches every part once the
 * page is idle, so each is already there by the time anyone reaches it.
 */
export function lazyPart<Props extends object>(load: () => Promise<ComponentType<Props>>) {
  loaders.push(load)
  return lazy(() => load().then((component) => ({ default: component }), reloadOnce))
}

/** After the page is up: fetch every part split off with lazyPart. */
export function preloadParts() {
  const run = () =>
    Promise.all(loaders.map((load) => load())).then(
      () => sessionStorage.removeItem(RELOADED_FOR_PARTS),
      reloadOnce,
    )
  if ('requestIdleCallback' in window) requestIdleCallback(() => void run())
  else setTimeout(() => void run(), 200)
}
