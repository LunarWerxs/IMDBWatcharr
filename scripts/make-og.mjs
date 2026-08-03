// Rasterise the share card.
//
// Most platforms refuse to render an SVG og:image, so the PNG is what actually
// ships and the SVG stays as the editable original. Run `npm run og` after
// editing web/public/og-image.svg.
//
// The card embeds Inter, the same face the site uses, rather than trusting
// whatever the rasteriser finds installed: a machine without Inter would
// silently produce a card in a different typeface and nothing would fail.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "web", "public");
const interDir = path.join(rootDir, "node_modules", "@fontsource-variable", "inter", "files");

// The catalog card on lunarwerx.com reads its banner from that site's repo, so
// the banner is generated here (next to the brand it belongs to) and copied
// there. Skipped without complaint when the sibling checkout is absent.
const studioBanners = path.resolve(
  rootDir,
  "..",
  "LunarWerx",
  "website",
  "lunarwerx.website.v1.1",
  "public",
  "banners",
);

async function render(name, width) {
  const svg = await readFile(path.join(publicDir, `${name}.svg`), "utf8");
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontDirs: [interDir],
      defaultFontFamily: "Inter Variable",
      loadSystemFonts: true,
    },
  })
    .render()
    .asPng();

  const target = path.join(publicDir, `${name}.png`);
  await writeFile(target, png);
  console.log(`Wrote ${path.relative(rootDir, target)} (${(png.length / 1024).toFixed(1)} KB)`);
  return png;
}

await render("og-image", 1200);
const banner = await render("banner", 1200);

try {
  const copied = path.join(studioBanners, "imdbwatcharr.png");
  await writeFile(copied, banner);
  console.log(`Copied the banner to ${copied}`);
} catch (error) {
  console.log(`Skipped the studio banner copy: ${error.message}`);
}
