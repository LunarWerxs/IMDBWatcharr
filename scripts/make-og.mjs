// Rasterise the share card, the studio banner and the icons.
//
// Most platforms refuse to render an SVG og:image, so the PNG is what actually
// ships and the SVG stays as the editable original. Run `npm run og` after
// editing web/public/og-image.svg, banner.svg or favicon.svg.
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
const studioBanners = path.resolve(rootDir, "..", "LunarWerx", "site", "public", "banners");

async function rasterise(name, width) {
  const svg = await readFile(path.join(publicDir, `${name}.svg`), "utf8");
  return new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontDirs: [interDir],
      defaultFontFamily: "Inter Variable",
      loadSystemFonts: true,
    },
  })
    .render()
    .asPng();
}

async function render(name, width) {
  const png = await rasterise(name, width);
  const target = path.join(publicDir, `${name}.png`);
  await writeFile(target, png);
  console.log(`Wrote ${path.relative(rootDir, target)} (${(png.length / 1024).toFixed(1)} KB)`);
}

// The icons for places that will not take the SVG favicon: /favicon.ico, which
// browsers and crawlers ask for whatever the page says, and the home-screen
// icon, full-bleed because iOS rounds the corners itself.
function renderIcon(svg, size) {
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

// An .ico is a small directory of images; modern ones may simply hold PNGs.
function icoOf(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

async function renderIcons() {
  const svg = await readFile(path.join(publicDir, "favicon.svg"), "utf8");
  const ico = icoOf([16, 32, 48].map((size) => ({ size, png: renderIcon(svg, size) })));
  await writeFile(path.join(publicDir, "favicon.ico"), ico);
  const touch = renderIcon(svg.replace(/ rx="\d+"/, ""), 180);
  await writeFile(path.join(publicDir, "apple-touch-icon.png"), touch);
  console.log(`Wrote web/public/favicon.ico (${(ico.length / 1024).toFixed(1)} KB) and apple-touch-icon.png (${(touch.length / 1024).toFixed(1)} KB)`);
}

await render("og-image", 1200);
// The banner is only ever shown on lunarwerx.com, so it is written there and
// nowhere on this site.
const banner = await rasterise("banner", 1200);
await renderIcons();

try {
  const copied = path.join(studioBanners, "imdbwatcharr.png");
  await writeFile(copied, banner);
  console.log(`Copied the banner to ${copied}`);
} catch (error) {
  console.log(`Skipped the studio banner copy: ${error.message}`);
}
