// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // Two renderers share one Vite build: the transparent pie overlay
  // (src/renderer) and the editor window (src/editor). Root is their
  // common parent so rollup preserves each entry's sub-path in the
  // output — `src/renderer/index.html` → `dist-electron/renderer/...`,
  // `src/editor/index.html` → `dist-electron/editor/...`. Dev mode
  // therefore serves them at /renderer/index.html and /editor/index.html
  // (see the loadURL sites in src/main).
  root: 'src',
  plugins: [react()],
  // Electron renderers load index.html from a file:// URL in production,
  // so we keep paths relative — absolute /assets URLs would 404.
  base: './',
  resolve: {
    alias: {
      '@/shared': path.resolve(__dirname, 'src/shared'),
      '@/core': path.resolve(__dirname, 'src/core'),
    },
  },
  build: {
    // Land alongside the compiled Electron main so the relative
    // `loadFile('../renderer/index.html')` / `'../editor/index.html'`
    // from dist-electron/main resolve without crossing build dirs.
    outDir: path.resolve(__dirname, 'dist-electron'),
    // outDir sits outside `root`; emptyOutDir:true both silences Vite's
    // safety prompt and clears stale renderer/editor bundles. The
    // electron-main compile (tsc -p tsconfig.electron.json) runs *after*
    // vite in `npm run build`, so wiping dist-electron here is safe —
    // main/ is regenerated immediately afterwards.
    emptyOutDir: true,
    rollupOptions: {
      input: {
        renderer: path.resolve(__dirname, 'src/renderer/index.html'),
        editor: path.resolve(__dirname, 'src/editor/index.html'),
      },
    },
  },
  // Renderer dev server lives on a fixed port so the Electron main
  // process can connect to it during `npm run dev` without sniffing.
  server: {
    port: 5173,
    strictPort: true,
  },
});
