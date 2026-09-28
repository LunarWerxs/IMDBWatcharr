// The questions people ask about IMDb Watcharr, in one place: the page shows
// them (FaqSection) and the same entries become the page's FAQPage structured
// data, so what a search engine is told is exactly what a visitor can read.

type FaqEntry = { question: string; answer: string }

export const FAQ: readonly FaqEntry[] = [
  {
    question: 'Is IMDb Watcharr free?',
    answer:
      'Yes. There is no paid tier and no payment anywhere in the app. The source is on GitHub, so you can also run your own copy for noncommercial use. It is a personal, noncommercial tool on purpose: IMDb’s own terms do not allow public or commercial use of its data.',
  },
  {
    question: 'Do I need an account to use IMDb Watcharr?',
    answer:
      'No. Paste a public IMDb watchlist or list URL and you get two links back straight away. They fill in on the list’s first read from IMDb, usually within a few minutes. Signing in only changes one thing: the list is then checked again about every fifteen minutes instead of staying on its first read.',
  },
  {
    question: 'How do I add an IMDb list to Radarr?',
    answer:
      'In Radarr, open Settings, then Lists, then Add List, switch to Advanced, and choose RSS List. Paste the Radarr link IMDb Watcharr made for your list. It comes from the IMDb list itself, so it never changes.',
  },
  {
    question: 'How do I add an IMDb list to Sonarr?',
    answer:
      'In Sonarr, open Settings, then Import Lists, then Add List, switch to Advanced, and choose Custom List. Paste the Sonarr link IMDb Watcharr made. It is a separate link from the Radarr one, because Sonarr adds shows by their TheTVDB id.',
  },
  {
    question: 'Why is a show missing from my Sonarr list?',
    answer:
      'Sonarr can only add shows that are listed on TheTVDB. IMDb Watcharr looks each show up on TVMaze and on TMDB to find it there. A show neither knows, usually one that was announced and never made, is left out rather than passed along broken, and it joins your link if it is ever listed.',
  },
  {
    question: 'How is this different from adding an IMDb list to Radarr or Sonarr directly?',
    answer:
      'Sonarr removed its built-in IMDb list import in 2025, and Radarr’s IMDb list import stopped working after IMDb changed its export format. IMDb Watcharr fills that gap: one pasted URL becomes a Radarr RSS feed and a Sonarr Custom List, and if a later read of the list fails, both keep serving the last good one.',
  },
  {
    question: 'Can I self-host IMDb Watcharr?',
    answer:
      'Yes, for noncommercial use. The code is on GitHub: a Cloudflare Worker with a D1 database, and a GitHub Actions job that reads the lists from IMDb. It cannot run offline, because the lists live on IMDb.',
  },
  {
    question: 'Why does a list I just pasted not show anything yet?',
    answer:
      'A new list is read from IMDb by a separate job, so it takes a moment, usually a minute or two. The page updates by itself when it lands. If it never does, the list is probably private on IMDb: make it public and paste it again.',
  },
]

/** The same entries as schema.org FAQPage data, for a JSON-LD script tag. */
export function faqJsonLd(pageUrl: string): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${pageUrl}#faq`,
    mainEntity: FAQ.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  }).replace(/</g, '\\u003c')
}
