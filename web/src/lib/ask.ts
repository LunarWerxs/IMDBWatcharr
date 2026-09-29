// Asking before something is deleted or taken away (components/ask.tsx draws
// the window): `useAsk()` returns a function that opens it and answers true or false.
import { createContext, use } from 'react'

export type Question = {
  title: string
  body: string
  /** The yes button's words: what it does ("Delete feed"), never "OK". */
  yes: string
}

export const AskContext = createContext<(question: Question) => Promise<boolean>>(async () => false)

export function useAsk() {
  return use(AskContext)
}
