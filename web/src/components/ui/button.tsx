import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        // The yes in a window asking before something is deleted or taken away.
        destructive: "bg-destructive font-bold text-white hover:bg-destructive/90",
        "ghost-destructive-muted":
          "text-muted-foreground hover:bg-muted hover:text-destructive aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        // The page's calls to action: IMDb yellow, bold, with a light sweeping across on hover.
        cta: "shine bg-primary font-bold text-primary-foreground hover:bg-primary/90",
        // Askarr's own call to action, in its colours: the way over to the sister app.
        askarr: "shine bg-askarr font-bold text-askarr-foreground hover:brightness-110",
        // A quiet icon button beside something more important (the link box's open button).
        "ghost-muted":
          "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:hover:bg-muted/50",
        // The black header's text buttons: yellow on hover, like IMDb's.
        "ghost-brand": "hover:bg-muted/50 hover:text-primary aria-expanded:bg-muted/50",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-8",
        // A standalone call to action; a leading logo tile (data-icon="tile") sits closer to the edge.
        cta: "h-10 gap-2.5 px-5 has-data-[icon=tile]:ps-1.5",
        // A big rounded call to action that lifts on hover (the title popup's); a leading logo
        // (data-icon="inline-start") sits a little closer to the edge.
        pill: "h-11 gap-2 rounded-full border-0 px-6 text-base shadow-lg shadow-black/30 hover:-translate-y-0.5 active:translate-y-0 has-data-[icon=inline-start]:gap-2.5 has-data-[icon=inline-start]:ps-4",
        // The same lift on a squarer, lower-shadowed button (the Askarr card's).
        lift: "h-11 gap-2.5 rounded-md border-0 ps-3.5 pe-5 text-base shadow-lg shadow-black/20 hover:-translate-y-0.5 active:translate-y-0",
        // The search bar's button: as tall as the field, joined to it from sm up, where the pair's
        // own ring shows focus (the button's would be clipped by the join).
        search:
          "h-12 gap-2 rounded-md border-0 px-7 text-base sm:h-full sm:rounded-l-none sm:focus-visible:ring-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
