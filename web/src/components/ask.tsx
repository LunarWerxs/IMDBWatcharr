// Asking before something is deleted or taken away, in the page's own window
// instead of the browser's white box: the question, what happens, and two
// buttons. Anything under AskProvider asks with lib/ask.ts's useAsk().
import { useCallback, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { AskContext, type Question } from '@/lib/ask'

/** Where the question window lives; everything under it can ask. */
export function AskProvider({ children }: { children: ReactNode }) {
  // The question stays after it is answered, so the window has words while it fades out.
  const [question, setQuestion] = useState<(Question & { answer: (yes: boolean) => void }) | null>(null)
  const [open, setOpen] = useState(false)

  const ask = useCallback(
    (next: Question) =>
      new Promise<boolean>((resolve) => {
        setQuestion({ ...next, answer: resolve })
        setOpen(true)
      }),
    [],
  )

  function answer(yes: boolean) {
    question?.answer(yes)
    setOpen(false)
  }

  return (
    <AskContext value={ask}>
      {children}
      <Dialog open={open} onOpenChange={(next) => !next && answer(false)}>
        {question && (
          <DialogContent
            className="max-w-sm"
            onCloseAutoFocus={(event) => {
              const target = question.returnFocus?.()
              if (!target) return
              event.preventDefault()
              target.focus()
            }}
          >
            <DialogTitle>{question.title}</DialogTitle>
            <DialogDescription>{question.body}</DialogDescription>
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" size="cta" onClick={() => answer(false)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" size="cta" onClick={() => answer(true)}>
                {question.yes}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </AskContext>
  )
}
