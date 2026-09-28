// The toasts load after the page rather than with it (see root.tsx), so a toast
// is raised through here: shown at once when the Toaster is listening, which it
// always is long before anyone has copied a link, and held until it is if not.
let listening = false
const held: Array<() => void> = []

/** Called by the Toaster once it is on the page. */
export function markToasterReady() {
  listening = true
  held.splice(0).forEach((show) => show())
}

export async function notify(kind: 'success' | 'error', message: string) {
  const { toast } = await import('sonner')
  const show = () => toast[kind](message)
  if (listening) show()
  else held.push(show)
}
