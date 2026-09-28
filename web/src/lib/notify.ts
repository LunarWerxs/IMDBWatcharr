// The toasts load after the page rather than with it (see root.tsx), so a toast
// is raised through here: it waits for the library and for the Toaster to be
// listening, which it always is long before anyone has copied a link.
let toasterReady: () => void = () => {}
const listening = new Promise<void>((resolve) => {
  toasterReady = resolve
})

/** Called by the Toaster once it is on the page. */
export function markToasterReady() {
  toasterReady()
}

export async function notify(kind: 'success' | 'error', message: string) {
  const [{ toast }] = await Promise.all([import('sonner'), listening])
  toast[kind](message)
}
