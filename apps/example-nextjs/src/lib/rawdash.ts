import { createRawdashClient, http } from '@rawdash/sdk-nextjs';

const isBuild = process.env['NEXT_PHASE'] === 'phase-production-build';
const isDev = process.env.NODE_ENV === 'development';

const baseUrl =
  process.env['RAWDASH_URL'] ??
  (isDev || isBuild ? 'http://localhost:8080' : undefined);

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
