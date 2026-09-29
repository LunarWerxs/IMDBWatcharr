import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

import { markToasterReady } from "@/lib/notify"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  // Sonner subscribes in its own effect, which runs before this one.
  useEffect(markToasterReady, [])
  // A phone's toasts come down from just under the header: at the bottom they sat over what the
  // button had just opened (the library's setup cards), for the whole of their four seconds.
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)")
    const read = () => setPhone(query.matches)
    read()
    query.addEventListener("change", read)
    return () => query.removeEventListener("change", read)
  }, [])

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position={phone ? "top-center" : "bottom-center"}
      mobileOffset={{ top: "4.5rem" }}
      className="group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          // A message that wraps breaks into even lines.
          title: "text-balance",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
