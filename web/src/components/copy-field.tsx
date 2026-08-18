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
    <div className="bg-muted/40 flex items-center gap-1 rounded-lg border p-1">
      <code className="min-w-0 flex-1 px-2 py-1 font-mono text-xs break-all sm:text-sm">
        {value}
      </code>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0"
            onClick={handleCopy}
            aria-label={`Copy ${label}`}
          >
            {copied ? (
              <CheckIcon className="size-4 text-emerald-500" />
            ) : (
              <CopyIcon className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy {label}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            size="icon"
            variant="ghost"
            className="shrink-0"
          >
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
    </div>
  )
}
