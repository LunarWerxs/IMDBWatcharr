import { cn } from '@/lib/utils'

function Block({ className }: { className: string }) {
  return <span className={cn('bg-muted shimmer block rounded-md', className)} />
}

/**
 * The library's outline while it loads: the feeds down the side (a row of
 * cards on a phone) and the picked one's cover, name and two buttons, where
 * each will land, so nothing jumps when they arrive. `hinted` is the copy the
 * page carries before it knows who is looking; it only shows for a browser
 * that was signed in last time (index.html, index.css).
 */
export function LibrarySkeleton({ hinted = false }: { hinted?: boolean }) {
  return (
    <div
      role="status"
      aria-label="Loading your feeds"
      data-library-hint={hinted ? '' : undefined}
      className="grid grid-cols-[minmax(0,1fr)] gap-6 pt-8 pb-4 sm:pt-10 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-10 lg:grid-cols-[18rem_minmax(0,1fr)]"
    >
      <div className="flex gap-3 overflow-hidden md:hidden">
        {[0, 1, 2].map((card) => (
          <span key={card} className="bg-card ring-foreground/10 flex w-36 shrink-0 flex-col gap-2 rounded-xl p-2.5 ring-1">
            <Block className="aspect-square w-full" />
            <Block className="h-4 w-20" />
          </span>
        ))}
      </div>
      <div className="bg-card ring-foreground/10 hidden rounded-xl p-2 ring-1 md:block">
        <Block className="mx-2 mt-1 mb-3 h-4 w-24" />
        {[0, 1, 2, 3].map((row) => (
          <span key={row} className="flex items-center gap-3 p-2">
            <Block className="size-10 shrink-0" />
            <span className="grid flex-1 gap-1.5">
              <Block className="h-3.5 w-3/4" />
              <Block className="h-3 w-1/2" />
            </span>
          </span>
        ))}
      </div>
      <div className="min-w-0">
        <div className="flex items-end gap-5">
          <Block className="hidden size-40 shrink-0 rounded-xl md:block" />
          <span className="grid flex-1 gap-3">
            <Block className="h-3 w-20" />
            <Block className="h-9 w-2/3" />
            <Block className="h-4 w-1/2" />
          </span>
        </div>
        <div className="mt-6 flex gap-2">
          <Block className="h-11 w-32" />
          <Block className="h-11 w-32" />
        </div>
      </div>
    </div>
  )
}
