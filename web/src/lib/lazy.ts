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

/**
 * A part of the page nobody sees on arrival (the title popup, the filled-in
 * result, the toasts, the signed-in extras), split out of the first download.
 * It is not left to load on first use: preloadParts fetches every part once the
 * page is idle, so each is already there by the time anyone reaches it.
 */
export function lazyPart<Props extends object>(load: () => Promise<ComponentType<Props>>) {
  loaders.push(load)
  return lazy(() => load().then((component) => ({ default: component })))
}

/** After the page is up: fetch every part split off with lazyPart. */
export function preloadParts() {
  const run = () => loaders.forEach((load) => void load())
  if ('requestIdleCallback' in window) requestIdleCallback(run)
  else setTimeout(run, 200)
}
