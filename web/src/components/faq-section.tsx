import { ChevronDownIcon } from 'lucide-react'

import { SectionTitle } from '@/components/site-chrome'
import { FAQ, faqJsonLd } from '@/lib/faq'

const PAGE_URL = 'https://watcharr.lunarwerx.com/'

/**
 * The questions, as a list that opens one answer at a time, IMDb-style. It is
 * in the prerendered page, so search engines and AI readers get the answers
 * as text, and its structured data comes from the same entries.
 */
export function FaqSection() {
  return (
    <section className="mt-12" aria-labelledby="faq">
      <SectionTitle id="faq">Questions</SectionTitle>
      <div className="bg-card ring-foreground/10 divide-foreground/10 divide-y overflow-hidden rounded-lg ring-1">
        {FAQ.map((entry) => (
          <details key={entry.question} name="faq" className="group">
            <summary className="hover:bg-foreground/5 flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-bold transition-colors sm:px-6 [&::-webkit-details-marker]:hidden">
              <h3 className="text-base">{entry.question}</h3>
              <ChevronDownIcon
                className="text-muted-foreground size-4 shrink-0 transition-transform duration-300 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <p className="text-muted-foreground max-w-3xl px-5 pb-5 text-sm leading-relaxed text-pretty sm:px-6">
              {entry.answer}
            </p>
          </details>
        ))}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd(PAGE_URL) }} />
    </section>
  )
}
