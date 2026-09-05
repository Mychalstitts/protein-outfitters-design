#!/usr/bin/env node
/**
 * Render the SVG masters to the PNG files Expo + the stores expect.
 *
 * Usage:
 *   npm install --save-dev sharp
 *   node scripts/build-icons.mjs
 *
 * Outputs:
 *   apps/mobile/assets/icon.png             1024x1024  (Apple, no alpha)
 *   apps/mobile/assets/adaptive-icon.png    1024x1024  (Android foreground)
 *   apps/mobile/assets/splash.png           2048x2048
 *   apps/mobile/assets/favicon.png            48x48    (web fallback)
 *   apps/web/public/favicon-32x32.png         32x32
 *   apps/web/public/og-image.png            1200x630
 *
 * If sharp isn't installed, prints a friendly message and exits 0 so the
 * scaffold doesn't error on first install.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.log(
    'sharp is not installed. Run `npm install --save-dev sharp` then re-run this script.\n' +
      'For now, your scaffold uses the SVG sources directly — you can wire PNGs later.',
  );
  process.exit(0);
}

const tasks = [
  // Apple icon — strip alpha, flatten on opaque background
  {
    src: join(ROOT, 'apps/mobile/assets/source/icon.svg'),
    dst: join(ROOT, 'apps/mobile/assets/icon.png'),
    size: 1024,
    flatten: '#1f7a3f',
  },
  // Android adaptive-icon foreground — keep alpha
  {
    src: join(ROOT, 'apps/mobile/assets/source/adaptive-icon-foreground.svg'),
    dst: join(ROOT, 'apps/mobile/assets/adaptive-icon.png'),
    size: 1024,
  },
  // Splash
  {
    src: join(ROOT, 'apps/mobile/assets/source/splash.svg'),
    dst: join(ROOT, 'apps/mobile/assets/splash.png'),
    size: 2048,
  },
  // Mobile web favicon
  {
    src: join(ROOT, 'apps/mobile/assets/source/icon.svg'),
    dst: join(ROOT, 'apps/mobile/assets/favicon.png'),
    size: 48,
  },
  // Next.js web favicon
  {
    src: join(ROOT, 'apps/web/public/favicon.svg'),
    dst: join(ROOT, 'apps/web/public/favicon-32x32.png'),
    size: 32,
  },
  // OG image
  {
    src: join(ROOT, 'apps/web/public/og-image.svg'),
    dst: join(ROOT, 'apps/web/public/og-image.png'),
    width: 1200,
    height: 630,
  },
];

for (const t of tasks) {
  if (!existsSync(t.src)) {
    console.warn(`Skipping (missing source): ${t.src}`);
    continue;
  }
  const outDir = dirname(t.dst);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  let pipe = sharp(t.src);
  if (t.size) pipe = pipe.resize(t.size, t.size);
  if (t.width && t.height) pipe = pipe.resize(t.width, t.height);
  if (t.flatten) pipe = pipe.flatten({ background: t.flatten });
  await pipe.png({ compressionLevel: 9 }).toFile(t.dst);
  console.log(`✓ ${t.dst.replace(ROOT + '/', '')}`);
}

console.log('\nIcons built. Verify by opening the PNGs.');
