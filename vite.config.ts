// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  // Electron renderer loads index.html from a file:// URL in production, so
  // we keep paths relative — absolute /assets URLs would 404.
  base: './',
  resolve: {
    alias: {
      '@/shared': path.resolve(__dirname, 'src/shared'),
      '@/core': path.resolve(__dirname, 'src/core'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  // Renderer dev server lives on a fixed port so the Electron main
  // process can connect to it during `npm run dev` without sniffing.
  server: {
    port: 5173,
    strictPort: true,
  },
});
