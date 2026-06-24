// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    // Node environment by default; the pie-geometry and protocol modules
    // are framework-free and don't need a DOM.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@/shared': path.resolve(__dirname, 'src/shared'),
      '@/core': path.resolve(__dirname, 'src/core'),
    },
  },
});
