import { useState } from 'react'
import { useTheme } from 'next-themes'
import { MoonIcon, SunIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useHydrated } from '@/lib/lazy'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  // The prerendered page is dark and cannot know a saved theme, so the icon
  // follows the saved one only once the page has hydrated.
  const isDark = !useHydrated() || resolvedTheme !== 'light'
  // The new icon turns in when the visitor switches, and not on the page's first paint.
  const [switched, setSwitched] = useState(false)
  const turn = switched ? 'motion-safe:animate-turn' : ''

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        setSwitched(true)
        setTheme(isDark ? 'light' : 'dark')
      }}
    >
      {isDark ? <SunIcon className={`size-4 ${turn}`} /> : <MoonIcon className={`size-4 ${turn}`} />}
    </Button>
  )
}
