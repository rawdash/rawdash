import { serve } from '@rawdash/server';

import config from './rawdash.config';

function resolvePort(): number {
  const raw = process.env['PORT'];
  if (raw === undefined || raw === '') {
    return 8080;
  }
  const parsed = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    console.warn(
      `Invalid PORT env var "${raw}" — falling back to default port 8080`,
    );
    return 8080;
  }
  return parsed;
}

serve(config, { port: resolvePort() });
