import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col", className)} {...props} />
}

// An underline row, the tabs of a record rather than a segmented control.
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("scrollbar-quiet flex items-center gap-5 overflow-x-auto border-b", className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 border-transparent py-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("pt-4 outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0", className)}
      {...props}
    />
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
