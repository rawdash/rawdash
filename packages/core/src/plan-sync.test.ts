import { describe, expect, it } from 'vitest';

import type { FetchSpec } from './backfill-window';
import {
  BACKFILL_CADENCE_MS,
  fetchSpecsHaveRequiredWindow,
  planSync,
} from './plan-sync';

const NOW = new Date('2026-06-28T12:00:00.000Z');

const windowedSpecs: Record<string, FetchSpec[]> = {
  pull_request: [{}, { requiredWindowMs: 7_776_000_000 }],
};
const windowlessSpecs: Record<string, FetchSpec[]> = {
  pull_request: [{}],
};

describe('fetchSpecsHaveRequiredWindow', () => {
  it('detects a positive requiredWindowMs on any spec', () => {
    expect(fetchSpecsHaveRequiredWindow(windowedSpecs)).toBe(true);
  });

  it('returns false when no spec declares a window', () => {
    expect(fetchSpecsHaveRequiredWindow(windowlessSpecs)).toBe(false);
  });

  it('returns false for undefined or empty maps', () => {
    expect(fetchSpecsHaveRequiredWindow(undefined)).toBe(false);
    expect(fetchSpecsHaveRequiredWindow({})).toBe(false);
  });

  it('ignores a zero or negative window', () => {
    expect(
      fetchSpecsHaveRequiredWindow({ pull_request: [{ requiredWindowMs: 0 }] }),
    ).toBe(false);
  });
});

describe('planSync', () => {
  it('forces full and a due backfill on the first sync when a window exists', () => {
    const plan = planSync({
      lastSyncAt: null,
      lastBackfillAt: null,
      fetchSpecs: windowedSpecs,
      now: NOW,
    });
    expect(plan.mode).toBe('full');
    expect(plan.backfillDue).toBe(true);
    expect(plan.options.mode).toBe('full');
    expect(plan.options.since).toBeUndefined();
    expect(plan.options.fetchSpecs).toBe(windowedSpecs);
  });

  it('forces full but not a backfill on a windowless first sync', () => {
    const plan = planSync({
      lastSyncAt: null,
      lastBackfillAt: null,
      fetchSpecs: windowlessSpecs,
      now: NOW,
    });
    expect(plan.mode).toBe('full');
    expect(plan.backfillDue).toBe(false);
    expect(plan.options.since).toBeUndefined();
  });

  it('stays on latest with no backfill when no windowed spec exists', () => {
    const lastSyncAt = new Date(NOW.getTime() - 300_000);
    const plan = planSync({
      lastSyncAt,
      lastBackfillAt: null,
      fetchSpecs: windowlessSpecs,
      now: NOW,
    });
    expect(plan.mode).toBe('latest');
    expect(plan.backfillDue).toBe(false);
    expect(plan.options.since).toBe(lastSyncAt.toISOString());
  });

  it('returns full when a windowed spec exists and no backfill has ever run', () => {
    const plan = planSync({
      lastSyncAt: new Date(NOW.getTime() - 300_000),
      lastBackfillAt: null,
      fetchSpecs: windowedSpecs,
      now: NOW,
    });
    expect(plan.mode).toBe('full');
    expect(plan.backfillDue).toBe(true);
    expect(plan.options.since).toBeUndefined();
  });

  it('returns full when the last windowed backfill is older than the cadence', () => {
    const plan = planSync({
      lastSyncAt: new Date(NOW.getTime() - 300_000),
      lastBackfillAt: new Date(NOW.getTime() - BACKFILL_CADENCE_MS - 1),
      fetchSpecs: windowedSpecs,
      now: NOW,
    });
    expect(plan.mode).toBe('full');
    expect(plan.backfillDue).toBe(true);
  });

  it('stays on latest when the last backfill is within the cadence', () => {
    const lastSyncAt = new Date(NOW.getTime() - 300_000);
    const plan = planSync({
      lastSyncAt,
      lastBackfillAt: new Date(NOW.getTime() - BACKFILL_CADENCE_MS + 1),
      fetchSpecs: windowedSpecs,
      now: NOW,
    });
    expect(plan.mode).toBe('latest');
    expect(plan.backfillDue).toBe(false);
    expect(plan.options.since).toBe(lastSyncAt.toISOString());
  });

  it('honors a custom cadence', () => {
    const plan = planSync({
      lastSyncAt: new Date(NOW.getTime() - 300_000),
      lastBackfillAt: new Date(NOW.getTime() - 10_000),
      fetchSpecs: windowedSpecs,
      now: NOW,
      cadenceMs: 5_000,
    });
    expect(plan.mode).toBe('full');
    expect(plan.backfillDue).toBe(true);
  });

  it('never marks a backfill due when no required window ever exists', () => {
    const plan = planSync({
      lastSyncAt: new Date(NOW.getTime() - 300_000),
      lastBackfillAt: new Date(NOW.getTime() - BACKFILL_CADENCE_MS * 10),
      fetchSpecs: windowlessSpecs,
      now: NOW,
    });
    expect(plan.mode).toBe('latest');
    expect(plan.backfillDue).toBe(false);
  });
});
