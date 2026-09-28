// The CSS custom properties the page sets inline. A custom property is the one
// inline style the design lint allows (everything else goes through classes),
// so these are typed here instead of cast at every use.
import 'react'

declare module 'react' {
  interface CSSProperties {
    '--delay'?: string
    '--duotone'?: string
    '--fan-x'?: string
    '--fan-r'?: string
    '--fan-z'?: number
    '--sticker-page'?: string
  }
}
