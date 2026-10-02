// The one-click setup. arr-setup.js becomes the "Add to Radarr / Sonarr" bookmark a result hands out;
// clicked inside the user's own Radarr or Sonarr, it reads that page's API root and key and saves this
// list's feed there as an import list. Nothing of theirs reaches Watcharr. (Two names on purpose: the
// bundler would resolve "lib/arr-setup" to the script, not to this file.)

import source from './arr-setup.js?raw'

/** What the setup is given: this list's two feed URLs and its name, nothing of the user's. */
export type ArrSetupConfig = {
  radarrUrl: string
  sonarrUrl: string
  listTitle: string
  /** Test the list in Radarr or Sonarr instead of saving it. */
  dryRun?: boolean
}

/**
 * The bookmark ("bookmarklet") for one list. Comments on lines of their own are dropped and the
 * indentation collapsed, so the link stays short; arr-setup.js keeps every string on one line and ends
 * every statement in a semicolon, so this cannot change what it does. The file is a set of functions;
 * the bookmark wraps them in one that hands back watcharrSetup, and calls that with the config.
 */
export function bookmarkletHref(config: ArrSetupConfig): string {
  const body = source
    .replace(/^[ \t]*\/\*(?:[^*]|\*(?!\/))*\*\/[ \t]*$/gm, '')
    .replace(/\n\s+/g, '\n')
    .trim()
  return `javascript:${encodeURIComponent(`(function(){${body}
return watcharrSetup;})()(${JSON.stringify(config)});void 0`)}`
}
