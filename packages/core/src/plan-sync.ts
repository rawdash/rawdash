import type { FetchSpec } from './backfill-window';
import type { SyncOptions } from './connector';

export const BACKFILL_CADENCE_MS = 60 * 60 * 1000;

export interface SyncSchedulingState {
  lastSyncAt: string | null;
  lastBackfillAt: string | null;
}

export interface PlanSyncInput {
  lastSyncAt: Date | null;
  lastBackfillAt: Date | null;
  fetchSpecs: Record<string, FetchSpec[]> | undefined;
  now: Date;
  cadenceMs?: number;
}

export interface PlanSyncResult {
  mode: 'full' | 'latest';
  options: SyncOptions;
  backfillDue: boolean;
}

export function fetchSpecsHaveRequiredWindow(
  fetchSpecs: Record<string, FetchSpec[]> | undefined,
): boolean {
  if (!fetchSpecs) {
    return false;
  }
  return Object.values(fetchSpecs).some((specs) =>
    specs.some(
      (spec) =>
        typeof spec.requiredWindowMs === 'number' && spec.requiredWindowMs > 0,
    ),
  );
}

export function planSync(input: PlanSyncInput): PlanSyncResult {
  const { lastSyncAt, lastBackfillAt, fetchSpecs, now } = input;
  const hasWindow = fetchSpecsHaveRequiredWindow(fetchSpecs);

  let mode: 'full' | 'latest';
  let backfillDue: boolean;
  if (lastSyncAt === null) {
    mode = 'full';
    backfillDue = hasWindow;
  } else {
    const cadenceMs = input.cadenceMs ?? BACKFILL_CADENCE_MS;
    backfillDue =
      hasWindow &&
      (lastBackfillAt === null ||
        now.getTime() - lastBackfillAt.getTime() >= cadenceMs);
    mode = backfillDue ? 'full' : 'latest';
  }

  const options: SyncOptions = { mode };
  if (mode === 'latest' && lastSyncAt !== null) {
    options.since = lastSyncAt.toISOString();
  }
  if (fetchSpecs && Object.keys(fetchSpecs).length > 0) {
    options.fetchSpecs = fetchSpecs;
  }

  return { mode, options, backfillDue };
}
