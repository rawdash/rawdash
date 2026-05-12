import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@rawdash/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
});
