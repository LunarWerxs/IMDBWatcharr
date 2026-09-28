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

/**
 * Where to cut a feed URL for showing it in a narrow box: the origin gives way
 * first, and the tail (the app and the list's id, which is what tells two links
 * apart) stays whole for as long as there is room.
 */
function splitForDisplay(value: string): [string, string] {
  const tail = value.split('/').slice(-3).join('/')
  const cut = value.length - tail.length - 1
  return cut > 0 ? [value.slice(0, cut), value.slice(cut)] : ['', value]
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

  const [head, tail] = splitForDisplay(value)
  return (
    // One box, with the link on the left and its two buttons inside it on the right. The fresh
    // ring flashes once when a link first appears, so the eye finds it.
    <div className="bg-background ring-foreground/10 flex h-11 items-center gap-1 rounded-md ps-3 pe-1.5 ring-1 motion-safe:animate-fresh">
      {/* Squeezed, the middle of the link gives way: "https://watcharr.lun…/radarr/l/ls0061". */}
      <code title={value} className="flex min-w-0 flex-1 font-mono text-xs select-all">
        <span className="min-w-0 truncate">{head}</span>
        <span className="max-w-full shrink-0 truncate">{tail}</span>
      </code>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild size="icon" variant="ghost-muted" className="size-8 shrink-0">
            <a href={value} target="_blank" rel="noreferrer" aria-label={`Open ${label} in a new tab`}>
              <ExternalLinkIcon className="size-4" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open {label}</TooltipContent>
      </Tooltip>
      <Button
        type="button"
        size="sm"
        variant="cta"
        className="h-8 min-w-19 shrink-0"
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
  )
}
