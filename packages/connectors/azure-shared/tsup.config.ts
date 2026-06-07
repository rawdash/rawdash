import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  external: ['@rawdash/core'],
  dts: true,
  sourcemap: true,
  clean: true,
});
