import type { ReactNode } from 'react'
import { Popover } from 'radix-ui'

/**
 * A note that opens from a small trigger in the result: a card with a coloured
 * top edge, a bold title and a line of explanation, then whatever the note
 * adds. `className` carries the edge's colour and the card's width.
 */
export function NotePopover({
  trigger,
  title,
  text,
  className,
  open,
  onOpenChange,
  children,
}: {
  trigger: ReactNode
  title: string
  text: string
  className: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={10}
          collisionPadding={16}
          className={`bg-popover text-popover-foreground ring-foreground/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-50 rounded-lg border-t-4 p-4 shadow-2xl ring-1 ${className}`}
        >
          <p className="font-bold">{title}</p>
          <p className="text-muted-foreground mt-1.5 text-sm text-pretty">{text}</p>
          {children}
          <Popover.Arrow className="fill-popover" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
