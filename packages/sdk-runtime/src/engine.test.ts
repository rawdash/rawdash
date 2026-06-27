import type { CachedWidget } from '@rawdash/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type SubscribeCallbacks, handleWidget, subscribe } from './engine';

const DEFAULTS = {
  syncingPollMs: 3_000,
  syncingPollMaxMs: 60_000,
  unsyncedPollMs: 10_000,
  failingBackoffMs: 60_000,
  lateRetryStartMs: 3_000,
  lateRetryMaxMs: 30_000,
  bootstrapRetryStartMs: 1_000,
  bootstrapRetryMaxMs: 30_000,
  bootstrapErrorAfterAttempts: 3,
  defaultIntervalSeconds: 300,
  jitterMs: 2_000,
};

function makeTracker(overrides: Partial<ReturnType<typeof emptyTracker>> = {}) {
  return { ...emptyTracker(), ...overrides };
}

function emptyTracker() {
  return {
    widgetId: 'w',
    lastSyncAtMs: null as number | null,
    lastSyncState: undefined as CachedWidget['syncState'],
    failingNotified: false,
    lateRetryDelayMs: null as number | null,
    syncingSinceMs: null as number | null,
    timer: null as unknown,
  };
}

function makeCallbacks(): SubscribeCallbacks & {
  updated: CachedWidget[];
  unchanged: CachedWidget[];
  failing: CachedWidget[];
  errors: unknown[];
} {
  const updated: CachedWidget[] = [];
  const unchanged: CachedWidget[] = [];
  const failing: CachedWidget[] = [];
  const errors: unknown[] = [];
  return {
    updated,
    unchanged,
    failing,
    errors,
    onWidgetUpdated: (w) => updated.push(w),
    onWidgetUnchanged: (w) => unchanged.push(w),
    onWidgetFailing: (w) => failing.push(w),
    onError: (e) => errors.push(e),
  };
}

function widget(overrides: Partial<CachedWidget>): CachedWidget {
  return {
    widgetId: 'w',
    connectorId: 'c',
    data: null,
    cachedAt: null,
    syncState: 'fresh',
    syncIntervalSeconds: 60,
    ...overrides,
  };
}

describe('handleWidget state machine', () => {
  it('on first fresh response, fires updated and schedules around lastSyncAt + interval', () => {
    const t = makeTracker();
    const cb = makeCallbacks();
    const lastSyncAt = '2026-05-23T00:00:00.000Z';
    const lastSyncMs = Date.parse(lastSyncAt);
    const now = lastSyncMs + 10_000;
    const w = widget({ cachedAt: lastSyncAt, syncIntervalSeconds: 60 });

    const delay = handleWidget(t, w, now, DEFAULTS, cb);

    expect(cb.updated).toHaveLength(1);
    expect(delay).toBe(50_000);
    expect(t.lastSyncAtMs).toBe(lastSyncMs);
  });

  it('fresh + advanced lastSyncAt fires updated again', () => {
    const cb = makeCallbacks();
    const t1 = '2026-05-23T00:00:00.000Z';
    const t2 = '2026-05-23T00:01:00.000Z';
    const t = makeTracker({ lastSyncAtMs: Date.parse(t1) });
    const delay = handleWidget(
      t,
      widget({ cachedAt: t2, syncIntervalSeconds: 60 }),
      Date.parse(t2),
      DEFAULTS,
      cb,
    );
    expect(cb.updated).toHaveLength(1);
    expect(cb.unchanged).toHaveLength(0);
    expect(delay).toBe(60_000);
  });

  it('fresh but lastSyncAt unchanged → fires unchanged, backs off 3s → 6s → 12s', () => {
    const cb = makeCallbacks();
    const last = Date.parse('2026-05-23T00:00:00.000Z');
    const t = makeTracker({ lastSyncAtMs: last });
    const w = widget({
      cachedAt: '2026-05-23T00:00:00.000Z',
      syncIntervalSeconds: 60,
    });
    const d1 = handleWidget(t, w, last + 65_000, DEFAULTS, cb);
    expect(d1).toBe(3_000);
    const d2 = handleWidget(t, w, last + 68_000, DEFAULTS, cb);
    expect(d2).toBe(6_000);
    const d3 = handleWidget(t, w, last + 74_000, DEFAULTS, cb);
    expect(d3).toBe(12_000);
    expect(cb.unchanged).toHaveLength(3);
    expect(cb.updated).toHaveLength(0);
  });

  it('late retry caps at lateRetryMaxMs', () => {
    const cb = makeCallbacks();
    const last = Date.parse('2026-05-23T00:00:00.000Z');
    const t = makeTracker({
      lastSyncAtMs: last,
      lateRetryDelayMs: 24_000,
    });
    const w = widget({
      cachedAt: '2026-05-23T00:00:00.000Z',
      syncIntervalSeconds: 60,
    });
    const d = handleWidget(t, w, last + 65_000, DEFAULTS, cb);
    expect(d).toBe(30_000);
  });

  it('late retry gives up after 2× interval and resumes normal schedule', () => {
    const cb = makeCallbacks();
    const last = Date.parse('2026-05-23T00:00:00.000Z');
    const t = makeTracker({ lastSyncAtMs: last, lateRetryDelayMs: 12_000 });
    const w = widget({
      cachedAt: '2026-05-23T00:00:00.000Z',
      syncIntervalSeconds: 60,
    });
    const now = last + 130_000;
    const d = handleWidget(t, w, now, DEFAULTS, cb);
    expect(d).toBeGreaterThanOrEqual(60_000);
    expect(t.lateRetryDelayMs).toBeNull();
  });

  it('syncing → fires unchanged and polls fast', () => {
    const cb = makeCallbacks();
    const t = makeTracker({
      lastSyncAtMs: Date.parse('2026-05-23T00:00:00.000Z'),
    });
    const w = widget({
      cachedAt: '2026-05-23T00:00:00.000Z',
      syncState: 'syncing',
    });
    const d = handleWidget(t, w, Date.now(), DEFAULTS, cb);
    expect(d).toBe(3_000);
    expect(cb.unchanged).toHaveLength(1);
  });

  it('syncing for too long → backs off to normal interval', () => {
    const cb = makeCallbacks();
    const start = 1_000_000;
    const t = makeTracker({ syncingSinceMs: start });
    const w = widget({ syncState: 'syncing', syncIntervalSeconds: 60 });
    const d = handleWidget(t, w, start + 61_000, DEFAULTS, cb);
    expect(d).toBe(60_000);
  });

  it('failing → fires onWidgetFailing once, then unchanged on repeats', () => {
    const cb = makeCallbacks();
    const t = makeTracker();
    const w = widget({ syncState: 'failing' });
    const d1 = handleWidget(t, w, 0, DEFAULTS, cb);
    expect(d1).toBe(60_000);
    expect(cb.failing).toHaveLength(1);
    handleWidget(t, w, 60_000, DEFAULTS, cb);
    expect(cb.failing).toHaveLength(1);
    expect(cb.unchanged).toHaveLength(1);
  });

  it('stale behaves like failing', () => {
    const cb = makeCallbacks();
    const t = makeTracker();
    const d = handleWidget(t, widget({ syncState: 'stale' }), 0, DEFAULTS, cb);
    expect(d).toBe(60_000);
    expect(cb.failing).toHaveLength(1);
  });

  it('unsynced → polls moderately', () => {
    const cb = makeCallbacks();
    const t = makeTracker();
    const d = handleWidget(
      t,
      widget({ syncState: 'unsynced', cachedAt: null }),
      0,
      DEFAULTS,
      cb,
    );
    expect(d).toBe(10_000);
    expect(cb.unchanged).toHaveLength(1);
  });

  it('transitioning from failing back to fresh resets the failing flag', () => {
    const cb = makeCallbacks();
    const t = makeTracker();
    handleWidget(t, widget({ syncState: 'failing' }), 0, DEFAULTS, cb);
    expect(t.failingNotified).toBe(true);
    handleWidget(
      t,
      widget({ syncState: 'fresh', cachedAt: '2026-05-23T00:00:00.000Z' }),
      Date.parse('2026-05-23T00:00:00.000Z'),
      DEFAULTS,
      cb,
    );
    expect(t.failingNotified).toBe(false);
    handleWidget(t, widget({ syncState: 'failing' }), 0, DEFAULTS, cb);
    expect(cb.failing).toHaveLength(2);
  });
});

describe('subscribe()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function fakeSource(widgets: CachedWidget[]) {
    const getWidgets = vi.fn(async () => widgets);
    const getWidget = vi.fn(async (_d: string, id: string) => {
      const w = widgets.find((x) => x.widgetId === id);
      if (!w) {
        throw new Error(`unknown widget ${id}`);
      }
      return w;
    });
    return {
      getWidgets,
      getWidget,
      getHealth: vi.fn(),
      getSyncState: vi.fn(),
      triggerSync: vi.fn(),
      ensureFresh: vi.fn(),
    };
  }

  it('bootstraps by calling getWidgets and fires updated for each', async () => {
    const widgets: CachedWidget[] = [
      widget({
        widgetId: 'a',
        cachedAt: '2026-05-23T00:00:00.000Z',
        syncState: 'fresh',
        syncIntervalSeconds: 60,
      }),
      widget({
        widgetId: 'b',
        cachedAt: '2026-05-23T00:00:00.000Z',
        syncState: 'fresh',
        syncIntervalSeconds: 60,
      }),
    ];
    const source = fakeSource(widgets);
    const cb = makeCallbacks();
    const unsub = subscribe(source, 'd', cb, {
      jitterMs: 0,
      visibility: null,
      random: () => 0,
    });
    await vi.runOnlyPendingTimersAsync();
    expect(source.getWidgets).toHaveBeenCalledWith('d');
    expect(cb.updated).toHaveLength(2);
    unsub();
  });

  it('fires onBootstrapped once after the first getWidgets resolves, even when empty', async () => {
    const source = fakeSource([]);
    const cb = makeCallbacks();
    const onBootstrapped = vi.fn();
    const unsub = subscribe(
      source,
      'd',
      { ...cb, onBootstrapped },
      { jitterMs: 0, visibility: null, random: () => 0 },
    );
    await vi.runOnlyPendingTimersAsync();
    expect(cb.updated).toHaveLength(0);
    expect(onBootstrapped).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('absorbs a transient bootstrap failure that recovers before the error threshold', async () => {
    const source = fakeSource([]);
    source.getWidgets.mockRejectedValueOnce(new Error('boom'));
    const cb = makeCallbacks();
    const onBootstrapped = vi.fn();
    const unsub = subscribe(
      source,
      'd',
      { ...cb, onBootstrapped },
      {
        jitterMs: 0,
        visibility: null,
        random: () => 0,
        bootstrapRetryStartMs: 1_000,
        bootstrapErrorAfterAttempts: 3,
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(cb.errors).toHaveLength(0);
    expect(onBootstrapped).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cb.errors).toHaveLength(0);
    expect(onBootstrapped).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('holds bootstrap and suppresses the error until the failure threshold is reached', async () => {
    const source = fakeSource([]);
    source.getWidgets.mockRejectedValue(new Error('boom'));
    const cb = makeCallbacks();
    const onBootstrapped = vi.fn();
    const unsub = subscribe(
      source,
      'd',
      { ...cb, onBootstrapped },
      {
        jitterMs: 0,
        visibility: null,
        random: () => 0,
        bootstrapRetryStartMs: 1_000,
        bootstrapRetryMaxMs: 8_000,
        bootstrapErrorAfterAttempts: 3,
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(cb.errors).toHaveLength(0);
    expect(onBootstrapped).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cb.errors).toHaveLength(0);
    expect(onBootstrapped).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(cb.errors).toHaveLength(1);
    expect(onBootstrapped).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('retries bootstrap on an escalating, capped backoff', async () => {
    const source = fakeSource([]);
    source.getWidgets.mockRejectedValue(new Error('boom'));
    const cb = makeCallbacks();
    const unsub = subscribe(source, 'd', cb, {
      jitterMs: 0,
      visibility: null,
      random: () => 0,
      bootstrapRetryStartMs: 1_000,
      bootstrapRetryMaxMs: 4_000,
      bootstrapErrorAfterAttempts: 99,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(source.getWidgets).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(source.getWidgets).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(source.getWidgets).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(source.getWidgets).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(source.getWidgets).toHaveBeenCalledTimes(5);
    unsub();
  });

  it('self-heals when a later bootstrap succeeds after surfacing an error', async () => {
    const source = fakeSource([
      widget({
        widgetId: 'a',
        cachedAt: '2026-05-23T00:00:00.000Z',
        syncState: 'fresh',
        syncIntervalSeconds: 60,
      }),
    ]);
    source.getWidgets
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'));
    const cb = makeCallbacks();
    const unsub = subscribe(source, 'd', cb, {
      jitterMs: 0,
      visibility: null,
      random: () => 0,
      bootstrapRetryStartMs: 1_000,
      bootstrapRetryMaxMs: 8_000,
      bootstrapErrorAfterAttempts: 3,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(cb.errors).toHaveLength(1);
    expect(cb.updated).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(cb.updated).toHaveLength(1);
    unsub();
  });

  it('does not poll while document is hidden, resumes on visibility', async () => {
    const widgets: CachedWidget[] = [
      widget({
        widgetId: 'a',
        cachedAt: '2026-05-23T00:00:00.000Z',
        syncState: 'fresh',
        syncIntervalSeconds: 60,
      }),
    ];
    const source = fakeSource(widgets);
    const cb = makeCallbacks();
    let hidden = true;
    const listeners: Array<() => void> = [];
    const unsub = subscribe(source, 'd', cb, {
      jitterMs: 0,
      random: () => 0,
      visibility: {
        isHidden: () => hidden,
        onChange: (l) => {
          listeners.push(l);
          return () => {
            const i = listeners.indexOf(l);
            if (i >= 0) {
              listeners.splice(i, 1);
            }
          };
        },
      },
    });
    await vi.runOnlyPendingTimersAsync();
    expect(source.getWidget).not.toHaveBeenCalled();
    hidden = false;
    listeners.forEach((l) => l());
    await vi.runOnlyPendingTimersAsync();
    expect(source.getWidget).toHaveBeenCalled();
    unsub();
  });
});
