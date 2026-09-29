// Asking before something is deleted or taken away (components/ask.tsx draws
// the window): `useAsk()` returns a function that opens it and answers true or false.
import { createContext, use } from 'react'

export type Question = {
  title: string
  body: string
  /** The yes button's words: what it does ("Delete feed"), never "OK". */
  yes: string
  /**
   * Where the keyboard goes once the window closes, asked then: what was
   * clicked may be gone by then (a row taken out, a feed deleted).
   */
  returnFocus?: () => HTMLElement | null | undefined
}

export const AskContext = createContext<(question: Question) => Promise<boolean>>(async () => false)

export function useAsk() {
  return use(AskContext)
}
