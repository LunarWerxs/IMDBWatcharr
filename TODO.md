# TODO

Queued for the next session. Nothing here is broken; it is all polish on top of a working site.

## Add IMDb Watcharr to the LunarWerx portfolio

Cross-repo, so it is easy to forget: the site at [lunarwerx.com](https://lunarwerx.com) says "17
products in production" and does not list this one. Add it and bump the count.

The site lives at `D:\PublicProjects\LunarWerx\website\lunarwerx.website.v1.1` (a Cloudflare Worker
with an assets binding, account `36d7c731fd0352ef08ea7e46d2d20793`). Copy an existing product entry
for the shape. It fits the apps-and-platforms bucket rather than developer tools.

Link it to <https://watcharr.lunarwerx.com>.

## Header

- **Back button, top left.** Goes to lunarwerx.com, matching the other products. Right now the only
  way back to the studio is the small "a LunarWerx product" line under the wordmark and the footer.
- **Move sign-in to the right of the theme toggle.** Order becomes GitHub, theme, then sign-in.
  Today `AccountControl` renders first. See the header block in [web/src/App.tsx](web/src/App.tsx).
- **GitHub icon expands on hover** to reveal the word "Selfhost". Icon-only at rest, widening to
  icon-plus-label on hover and focus. It is [web/src/components/github-link.tsx](web/src/components/github-link.tsx),
  currently a fixed-size icon button whose only label is the `aria-label`. Keep the accessible name
  when the visible text appears, and make sure keyboard focus triggers it too, not just the mouse.

## How it works

- **Give each of the three steps its own card** instead of the bare numbered grid it uses now.
- **Make the whole section collapsible, collapsed by default.** It is reference material for a
  first-time visitor, and a returning one just wants the input box.

Both live in the `STEPS` array and the `How it works` section of [web/src/App.tsx](web/src/App.tsx).

## Share card

There is no image, so a shared link renders as a bare text card. The Open Graph and Twitter tags in
[web/index.html](web/index.html) are already there but point at nothing, and `twitter:card` is
`summary` rather than `summary_large_image`.

Match what the sibling products do: a 1200x630 PNG at `/og-image.png`, drawn from an SVG source so
it can be regenerated. AnatomyOf and NormWind both do this, and both hit the same snag worth
copying their fix for: most platforms will not render an SVG og:image, so the raster is the one that
ships. Use the house palette and say "IMDb Watcharr" plus a one-line description.

## Footer

Too wordy at two paragraphs. Cut it down. The mechanics of what refreshes when are already said on
the result card, where they matter; the footer only needs the product line and the studio credit.

## Light theme

It is currently near-white and black, which reads as a default rather than a choice. Aim it at
IMDb's own look: amber `#F5C518` as the accent against white and near-black text, instead of the red
used in dark mode. Dark mode stays on the LunarWerx palette.

The tokens are the `:root` block in [web/src/index.css](web/src/index.css); `.dark` right below it
is the LunarWerx set and should not change. Check contrast on the primary button, because amber with
white text fails and wants dark text on top.
