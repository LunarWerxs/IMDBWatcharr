import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const inputVariants = cva(
  "w-full min-w-0 transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default:
          "h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-input/50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
        // IMDb's search field: white in both themes, joined to its button from sm up, room on
        // the right for a clear button, and the pair's own ring showing focus.
        search:
          "h-12 rounded-md border border-field-foreground/15 bg-field ps-4 pe-11 text-base text-field-foreground placeholder:text-field-foreground/45 sm:h-full sm:rounded-r-none dark:border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Input({
  className,
  type,
  variant = "default",
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      data-variant={variant}
      className={cn(inputVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Input }
