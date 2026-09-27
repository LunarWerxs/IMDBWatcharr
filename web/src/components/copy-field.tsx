import { useEffect, useState } from 'react'
import { CheckIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

async function writeToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // The API is THERE and it refused, which is a different thing from it
      // being missing - a permissions policy, an enterprise policy, a frame
      // without clipboard-write, a window that is not the focused one. None
      // of those gate the path below, so fall through and try it before
      // telling someone their browser cannot copy a URL.
    }
  }

  // arkitect-allow: no-bandaids - this repo is source-available and self-hosted over plain http, where navigator.clipboard does not exist at all (secure-context only), so this branch is the only copy path those installs have; nothing here is a compat shim awaiting removal.
  // Safari and non-secure contexts still need the legacy path.
  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  // iOS ignores select() on a textarea and copies nothing.
  field.setSelectionRange(0, value.length)
  const copied = document.execCommand('copy')
  field.remove()
  // Reported, not assumed. Without this the caller shows a check and says
  // "copied" on a path that quietly did nothing, which is worse than the
  // error: the URL they then paste is whatever was on the clipboard before.
  if (!copied) throw new Error('the browser refused the copy')
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function handleCopy() {
    try {
      await writeToClipboard(value)
      setCopied(true)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Could not copy. Select the URL and copy it manually.')
    }
  }

  return (
    <div className="grid gap-2">
      {/* The fresh ring flashes once when a link first appears, so the eye finds it. */}
      <code className="bg-background ring-foreground/10 block rounded-md px-3 py-2.5 font-mono text-xs leading-relaxed break-all ring-1 motion-safe:animate-fresh">
        {value}
      </code>
      <div className="flex items-center justify-end gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild size="icon" variant="ghost" className="shrink-0">
              <a
                href={value}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${label} in a new tab`}
              >
                <ExternalLinkIcon className="size-4" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open {label}</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          size="sm"
          className="min-w-20 font-bold"
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <>
              <CheckIcon className="size-3.5 motion-safe:animate-pop" />
              Copied
            </>
          ) : (
            <>
              <CopyIcon className="size-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
