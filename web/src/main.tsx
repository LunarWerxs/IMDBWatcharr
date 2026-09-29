import { createRoot, hydrateRoot } from 'react-dom/client'
import './index.css'
import { Root } from './root.tsx'
import { sendVisitPing } from '@/lib/analytics'
import { inDemo } from '@/lib/demo-mode'
import { installImeCompositionGuard } from '@/lib/ime-composition-guard'
import { preloadParts } from '@/lib/lazy'

// Before the first render: on Safari and Chrome-on-macOS the Enter that commits
// an input-method candidate is a plain key="Enter" keydown, so without this
// every Enter handler fires on half-typed Chinese, Japanese or Korean text.
installImeCompositionGuard()

// The production build prerenders the first view into #root (see
// scripts/prerender-web.mjs), so there it is hydrated rather than drawn again.
// `vite dev` serves the bare index.html, where #root is empty.
function start() {
  const container = document.getElementById('root')!
  if (container.hasChildNodes()) {
    hydrateRoot(container, <Root />)
  } else {
    createRoot(container).render(<Root />)
  }

  preloadParts()
  sendVisitPing()
}

// /?demo is the page signed in, with made-up lists and no account (lib/demo.ts).
// It has to answer the page's first calls, so it goes in before the page starts;
// everyone else never downloads it.
if (inDemo()) {
  void import('@/lib/demo').then(({ installDemo }) => installDemo()).finally(start)
} else {
  start()
}
