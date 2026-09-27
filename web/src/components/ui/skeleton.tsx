import { cn } from "@/lib/utils"

function Skeleton({
  className,
  shape = "default",
  ...props
}: React.ComponentProps<"div"> & { shape?: "default" | "card" }) {
  return (
    <div
      data-slot="skeleton"
      data-shape={shape}
      className={cn(
        "animate-pulse rounded-md bg-muted",
        shape === "card" && "rounded-xl",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
