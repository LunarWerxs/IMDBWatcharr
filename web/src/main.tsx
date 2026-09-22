import { createRoot, hydrateRoot } from 'react-dom/client'
import './index.css'
import { Root } from './root.tsx'
import { sendVisitPing } from '@/lib/analytics'
import { installImeCompositionGuard } from '@/lib/ime-composition-guard'

// Before the first render: on Safari and Chrome-on-macOS the Enter that commits
// an input-method candidate is a plain key="Enter" keydown, so without this
// every Enter handler fires on half-typed Chinese, Japanese or Korean text.
installImeCompositionGuard()

// The production build prerenders the first view into #root (see
// scripts/prerender-web.mjs), so there it is hydrated rather than drawn again.
// `vite dev` serves the bare index.html, where #root is empty.
const container = document.getElementById('root')!
if (container.hasChildNodes()) {
  hydrateRoot(container, <Root />)
} else {
  createRoot(container).render(<Root />)
}

sendVisitPing()
