import { ChevronDownIcon } from 'lucide-react'

import { SectionTitle } from '@/components/site-chrome'
import { FAQ } from '@/lib/faq'

/**
 * The questions, as a list that opens one answer at a time, IMDb-style. It is
 * in the prerendered page, so search engines and AI readers get the answers
 * as text, and the build writes its structured data from the same entries
 * into the page's head (scripts/prerender-web.mjs).
 */
export function FaqSection() {
  return (
    <section className="mt-12" aria-labelledby="faq">
      <SectionTitle id="faq">Questions</SectionTitle>
      <div className="bg-card ring-foreground/10 divide-foreground/10 divide-y overflow-hidden rounded-lg ring-1">
        {FAQ.map((entry) => (
          <details key={entry.question} name="faq" className="group details-fold">
            <summary className="hover:bg-foreground/5 group-open:bg-foreground/5 flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-bold transition-colors sm:px-6 [&::-webkit-details-marker]:hidden">
              <h3 className="text-base">{entry.question}</h3>
              <ChevronDownIcon
                className="text-muted-foreground group-open:text-ink size-4 shrink-0 transition duration-300 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            {/* The answer folds open (details-fold) and fades in as it does. */}
            <p className="text-muted-foreground max-w-3xl px-5 pt-3 pb-5 text-sm leading-relaxed text-pretty group-open:motion-safe:animate-fade-in sm:px-6">
              {entry.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  )
}
