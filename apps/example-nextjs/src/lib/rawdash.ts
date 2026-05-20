import { createRawdashClient, http } from '@rawdash/nextjs';

const baseUrl =
  process.env['RAWDASH_URL'] ??
  (process.env.NODE_ENV === 'development'
    ? 'http://localhost:8080'
    : undefined);

if (!baseUrl) {
  throw new Error(
    'RAWDASH_URL must be configured (no localhost fallback outside development)',
  );
}

export const rawdash = createRawdashClient(
  http({
    baseUrl,
    apiKey: process.env['RAWDASH_API_KEY'],
  }),
);
