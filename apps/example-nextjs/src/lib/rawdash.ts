import { createRawdashClient } from '@rawdash/nextjs';

export const rawdash = createRawdashClient({
  url: process.env['RAWDASH_URL'] ?? 'http://localhost:8080',
});
