'use server';

import { rawdash } from '@/lib/rawdash';

export async function triggerSync(): Promise<void> {
  await rawdash.triggerSync();
}
