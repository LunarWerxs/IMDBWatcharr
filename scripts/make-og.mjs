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
const source = path.join(rootDir, "web", "public", "og-image.svg");
const target = path.join(rootDir, "web", "public", "og-image.png");
const interDir = path.join(rootDir, "node_modules", "@fontsource-variable", "inter", "files");

const svg = await readFile(source, "utf8");

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  font: {
    fontDirs: [interDir],
    defaultFontFamily: "Inter Variable",
    loadSystemFonts: true,
  },
})
  .render()
  .asPng();

await writeFile(target, png);
console.log(`Wrote ${path.relative(rootDir, target)} (${(png.length / 1024).toFixed(1)} KB)`);
