import { renderToString } from 'react-dom/server'
import { Root } from './root.tsx'

// Build-time only (scripts/prerender-web.mjs): the first view as HTML, so a
// phone paints the page as soon as the HTML and stylesheet arrive instead of
// after downloading and running the whole bundle. Every piece of App's state
// starts empty and the session is read in an effect, so this is exactly what
// the browser's own first render produces, and main.tsx hydrates it in place.
export function render(): string {
  return renderToString(<Root />)
}
