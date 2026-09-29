import { EyeIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DEMO_INVITE_URL } from '@/lib/demo-mode'

/** Says the page is the demo (/?demo): signed in as a made-up person, with nothing saved. */
export function DemoBanner() {
  return (
    <div className="bg-card border-primary ring-foreground/10 mt-6 flex flex-col gap-3 rounded-lg border-l-4 p-4 ring-1 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <p className="flex items-start gap-2 text-sm text-pretty">
        <EyeIcon className="text-ink mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-bold">Demo.</span>{' '}
          <span className="text-muted-foreground">
            This is Watcharr signed in, as Alex, with made-up people. Try anything: nothing is saved, and a reload
            starts over.
          </span>
        </span>
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button asChild variant="secondary" size="sm">
          <a href={DEMO_INVITE_URL}>See an invite</a>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href="/">Leave the demo</a>
        </Button>
      </div>
    </div>
  )
}
