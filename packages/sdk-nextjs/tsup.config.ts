import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts', 'src/skeleton.tsx'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
});
