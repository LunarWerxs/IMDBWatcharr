import { StrictMode } from 'react'
import { ThemeProvider } from 'next-themes'
import App from './App.tsx'
import { Toaster } from '@/components/ui/sonner'

// The whole tree, in one place, because two things render it and they must
// agree exactly: the browser (main.tsx) and the build-time prerender
// (entry-prerender.tsx), whose HTML the browser then hydrates. A difference
// between the two is a hydration mismatch.
export function Root() {
  return (
    <StrictMode>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <App />
        <Toaster position="bottom-center" />
      </ThemeProvider>
    </StrictMode>
  )
}
