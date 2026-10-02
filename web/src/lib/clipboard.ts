/** Copy text, or throw when the browser refused: a copy that silently did nothing is worse than an error. */
export async function writeToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // The API is THERE and it refused, which is a different thing from it
      // being missing - a permissions policy, an enterprise policy, a frame
      // without clipboard-write, a window that is not the focused one. None
      // of those gate the path below, so fall through and try it before
      // telling someone their browser cannot copy a URL.
    }
  }

  // Safari and non-secure contexts (plain http self-hosts) have no navigator.clipboard, so this is their only copy path.
  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  // iOS ignores select() on a textarea and copies nothing.
  field.setSelectionRange(0, value.length)
  const copied = document.execCommand('copy')
  field.remove()
  // Reported, not assumed. Without this the caller shows a check and says
  // "copied" on a path that quietly did nothing, which is worse than the
  // error: the URL they then paste is whatever was on the clipboard before.
  if (!copied) throw new Error('the browser refused the copy')
}
