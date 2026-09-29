import { StrictMode, Suspense } from 'react'
import { ThemeProvider } from 'next-themes'
import App from './App.tsx'
import { lazyPart, useHydrated } from '@/lib/lazy'

const Toaster = lazyPart(() => import('@/components/ui/sonner').then((module) => module.Toaster))

// The whole tree, in one place, because two things render it and they must
// agree exactly: the browser (main.tsx) and the build-time prerender
// (entry-prerender.tsx), whose HTML the browser then hydrates. A difference
// between the two is a hydration mismatch, which is why the toasts, which have
// nothing to show on arrival, only mount once the page is running.
export function Root() {
  const hydrated = useHydrated()
  return (
    <StrictMode>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <App />
        {hydrated && (
          <Suspense fallback={null}>
            <Toaster />
          </Suspense>
        )}
      </ThemeProvider>
    </StrictMode>
  )
}
