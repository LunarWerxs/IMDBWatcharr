import { EyeIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DEMO_INVITE_URL, DEMO_LAYOUTS, DEMO_PARAM, type DemoLayout } from '@/lib/demo-mode'
import { cn } from '@/lib/utils'

/**
 * Says the page is the demo (/?demo): signed in as a made-up person, with
 * nothing saved. While the signed-in layout is being chosen, it also switches
 * between them (?demo=1, 2, 3).
 */
export function DemoBanner({ layout }: { layout: DemoLayout }) {
  return (
    <div className="bg-card border-primary ring-foreground/10 mt-6 flex flex-col gap-3 rounded-lg border-l-4 p-3 ring-1 lg:flex-row lg:items-center lg:justify-between lg:p-4">
      <p className="flex items-start gap-2 text-sm text-pretty">
        <EyeIcon className="text-ink mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-bold">Demo.</span>{' '}
          <span className="text-muted-foreground">Signed in as Alex, a made-up person. Nothing is saved.</span>
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Layout" className="bg-secondary flex rounded-lg p-0.5">
          {DEMO_LAYOUTS.map((entry) => (
            <a
              key={entry.layout}
              href={`/?${DEMO_PARAM}=${entry.layout}`}
              aria-current={entry.layout === layout ? 'page' : undefined}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
                entry.layout === layout
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {entry.layout}. {entry.name}
            </a>
          ))}
        </nav>
        <Button asChild variant="ghost" size="sm">
          <a href={`${DEMO_INVITE_URL.replace(`?${DEMO_PARAM}&`, `?${DEMO_PARAM}=${layout}&`)}`}>See an invite</a>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href="/">Leave</a>
        </Button>
      </div>
    </div>
  )
}
