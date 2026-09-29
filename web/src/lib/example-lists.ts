// Public IMDb lists to try, none of them anyone's own watchlist: films, shows,
// and a mix of both. All read cleanly, covers and all, on 2026-09-28, and each
// is pre-built on the live site so its first click is instant: build any list
// added here the same way (POST it to /api/create, then run the sync once).
export const EXAMPLE_LISTS = [
  { name: 'The 100 greatest movies', url: 'https://www.imdb.com/list/ls055592025/' },
  { name: 'Variety’s 100 greatest TV shows', url: 'https://www.imdb.com/list/ls522130686/' },
  { name: 'Every Marvel movie and show', url: 'https://www.imdb.com/list/ls505369170/' },
  { name: 'Every Best Picture winner', url: 'https://www.imdb.com/list/ls009480135/' },
  { name: 'Every Studio Ghibli film', url: 'https://www.imdb.com/list/ls575362999/' },
  { name: 'The top 100 TV shows', url: 'https://www.imdb.com/list/ls004729995/' },
] as const
