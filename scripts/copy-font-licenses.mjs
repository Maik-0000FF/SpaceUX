// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Copy the bundled fonts' SIL OFL-1.1 license texts into the build output so
 * they ship alongside the woff2 that Vite emits into dist-electron/assets.
 * OFL-1.1 requires the license to travel with the font files when
 * redistributed (#69 / #237). Run after `vite build`; the texts land in
 * dist-electron/licenses/ and ride whatever packaging wraps dist-electron.
 *
 * copyFileSync throws if a source is missing, so a removed/renamed font
 * package fails the build loudly rather than silently shipping unlicensed
 * fonts.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('dist-electron', 'licenses');

const FONTS = [
  {
    name: 'Inter',
    src: 'node_modules/@fontsource-variable/inter/LICENSE',
    out: 'OFL-1.1-Inter.txt',
  },
  {
    name: 'JetBrains Mono',
    src: 'node_modules/@fontsource-variable/jetbrains-mono/LICENSE',
    out: 'OFL-1.1-JetBrains-Mono.txt',
  },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const font of FONTS) {
  copyFileSync(path.resolve(font.src), path.join(OUT_DIR, font.out));
  // eslint-disable-next-line no-console
  console.log(`[font-licenses] ${font.name} -> licenses/${font.out}`);
}
