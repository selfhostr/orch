// Regenerates the PNG app icons and favicon.svg in public/ from the logo geometry (Brand.tsx).
// Run from the repo root:
//   docker run --rm -u "$(id -u)" -v "$PWD:/w" -w /tmp node:24-slim sh -c \
//     "npm i sharp@latest && node /w/apps/web/scripts/make-icons.mjs /w/apps/web/public"
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const out = process.argv[2];
const TILE = '#17181c';
const LIGHT = '#ecedef';
const HUB = '#e8743b';

// Glyph in the 64x64 logo space: three spokes from the centre hub to three nodes.
function glyph(light, hub) {
  return `<path d="M32 32V14M32 32 47.6 41M32 32 16.4 41" fill="none" stroke="${light}" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="14" r="4.5" fill="${light}"/><circle cx="47.6" cy="41" r="4.5" fill="${light}"/><circle cx="16.4" cy="41" r="4.5" fill="${light}"/><circle cx="32" cy="32" r="7" fill="${hub}"/>`;
}
// Tile (rounded when radius > 0) with the glyph scaled about the centre.
function svg(size, { radius = 0, bg = TILE, scale = 1, light = LIGHT, hub = HUB }) {
  const k = size / 64;
  const rect = bg ? `<rect width="64" height="64" rx="${radius}" fill="${bg}"/>` : '';
  const g = `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${glyph(light, hub)}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" data-k="${k}">${rect}${g}</svg>`;
}
const png = (name, s, opts) =>
  sharp(Buffer.from(svg(s, opts)), { density: (72 * s) / 64 })
    .resize(s, s)
    .png()
    .toFile(join(out, name));

// "any": the logo tile itself. Apple touch / maskable: opaque full-bleed tile, glyph inset.
await png('icon-192.png', 192, { radius: 15 });
await png('icon-512.png', 512, { radius: 15 });
await png('apple-touch-icon.png', 180, { radius: 0, scale: 0.9 });
await png('icon-maskable-512.png', 512, { radius: 0, scale: 0.75 });
await png('icon-monochrome-512.png', 512, { bg: null, scale: 1.1, light: '#000', hub: '#000' });
await writeFile(join(out, 'favicon.svg'), svg(64, { radius: 15 }).replace(/ data-k="[^"]*"/, ''));
