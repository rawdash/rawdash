import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  noExternal: ['@rawdash/connector-azure-shared', '@rawdash/connector-shared'],
  dts: true,
  sourcemap: true,
  clean: true,
});
