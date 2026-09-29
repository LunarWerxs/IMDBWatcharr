import * as React from "react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 min-w-48 origin-(--radix-dropdown-menu-content-transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-xl ring-1 ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { variant?: "default" | "destructive" }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        "flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted data-[variant=destructive]:text-destructive [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground data-[variant=destructive]:[&_svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger }
