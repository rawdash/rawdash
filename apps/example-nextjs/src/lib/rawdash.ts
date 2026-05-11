import { createRawdashClient, http } from '@rawdash/nextjs';

export const rawdash = createRawdashClient(
  http({ baseUrl: process.env['RAWDASH_URL'] ?? 'http://localhost:8080' }),
);
