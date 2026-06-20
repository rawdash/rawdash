import { http } from '@rawdash/sdk-client';

const baseUrl = process.env['NEXT_PUBLIC_RAWDASH_PROXY_URL'] ?? '/api';

export const rawdashSource = http({ baseUrl });
