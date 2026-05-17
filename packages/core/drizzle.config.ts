import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: '../adapters/turso/src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
});
