import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import './index.css'
import App from './App.tsx'
import { Toaster } from '@/components/ui/sonner'
import { sendVisitPing } from '@/lib/analytics'
import { installImeCompositionGuard } from '@/lib/ime-composition-guard'

// Before the first render: on Safari and Chrome-on-macOS the Enter that commits
// an input-method candidate is a plain key="Enter" keydown, so without this
// every Enter handler fires on half-typed Chinese, Japanese or Korean text.
installImeCompositionGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <App />
      <Toaster position="bottom-center" />
    </ThemeProvider>
  </StrictMode>,
)

sendVisitPing()
