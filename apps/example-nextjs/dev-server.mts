import { serve } from '@rawdash/server';

import config from './rawdash.config.mts';

function resolvePort(): number {
  const raw = process.env['PORT'];
  if (raw === undefined || raw === '') return 8080;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    console.warn(`Invalid PORT env var "${raw}" — falling back to default port 8080`);
    return 8080;
  }
  return parsed;
}

serve(config, { port: resolvePort() });
