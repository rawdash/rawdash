import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/metadata.ts', 'src/registry.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
});
