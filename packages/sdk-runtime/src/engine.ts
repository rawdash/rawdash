import type { CachedWidget, DataSource, WidgetSyncState } from '@rawdash/core';

export interface SubscribeCallbacks {
  onWidgetUpdated: (widget: CachedWidget) => void;
  onWidgetUnchanged?: (widget: CachedWidget) => void;
  onWidgetFailing?: (widget: CachedWidget) => void;
  onError?: (error: unknown) => void;
  onBootstrapped?: () => void;
}

export interface SubscribeOptions {
  syncingPollMs?: number;
  syncingPollMaxMs?: number;
  unsyncedPollMs?: number;
  failingBackoffMs?: number;
  lateRetryStartMs?: number;
  lateRetryMaxMs?: number;
  bootstrapRetryStartMs?: number;
  bootstrapRetryMaxMs?: number;
  bootstrapErrorAfterAttempts?: number;
  defaultIntervalSeconds?: number;
  jitterMs?: number;
  now?: () => number;
  setTimeout?: (cb: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  random?: () => number;
  visibility?: VisibilitySource | null;
}

export interface VisibilitySource {
  isHidden(): boolean;
  onChange(listener: () => void): () => void;
}

interface ResolvedOptions {
  syncingPollMs: number;
  syncingPollMaxMs: number;
  unsyncedPollMs: number;
  failingBackoffMs: number;
  lateRetryStartMs: number;
  lateRetryMaxMs: number;
  bootstrapRetryStartMs: number;
  bootstrapRetryMaxMs: number;
  bootstrapErrorAfterAttempts: number;
  defaultIntervalSeconds: number;
  jitterMs: number;
}

const DEFAULT_OPTIONS: ResolvedOptions = {
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

type Timer = unknown;

interface WidgetTracker {
  widgetId: string;
  lastSyncAtMs: number | null;
  lastSyncState: WidgetSyncState | undefined;
  failingNotified: boolean;
  lateRetryDelayMs: number | null;
  syncingSinceMs: number | null;
  timer: Timer | null;
}

export type Unsubscribe = () => void;

export function subscribe(
  source: DataSource,
  dashboardId: string,
  callbacks: SubscribeCallbacks,
  options: SubscribeOptions = {},
): Unsubscribe {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = opts.clearTimeout ?? ((h) => clearTimeout(h as never));
  const random = opts.random ?? Math.random;
  const visibility = opts.visibility ?? defaultVisibility();

  const trackers = new Map<string, WidgetTracker>();
  let stopped = false;
  let visibilityCleanup: (() => void) | null = null;
  let bootstrapRetryHandle: Timer | null = null;
  let bootstrapSettled = false;
  let bootstrapAttempts = 0;
  let bootstrapRetryDelayMs = 0;

  function settleBootstrap(): void {
    if (bootstrapSettled) {
      return;
    }
    bootstrapSettled = true;
    callbacks.onBootstrapped?.();
  }

  function schedule(t: WidgetTracker, delayMs: number): void {
    if (stopped) {
      return;
    }
    if (t.timer !== null) {
      clearTimer(t.timer);
      t.timer = null;
    }
    if (visibility && visibility.isHidden()) {
      return;
    }
    const jitter = Math.floor(random() * opts.jitterMs);
    t.timer = setTimer(
      () => {
        t.timer = null;
        void poll(t);
      },
      Math.max(0, delayMs + jitter),
    );
  }

  function tracker(widgetId: string): WidgetTracker {
    let t = trackers.get(widgetId);
    if (!t) {
      t = {
        widgetId,
        lastSyncAtMs: null,
        lastSyncState: undefined,
        failingNotified: false,
        lateRetryDelayMs: null,
        syncingSinceMs: null,
        timer: null,
      };
      trackers.set(widgetId, t);
    }
    return t;
  }

  function applyWidget(widget: CachedWidget): void {
    const t = tracker(widget.widgetId);
    const nextDelay = handleWidget(t, widget, now(), opts, callbacks);
    schedule(t, nextDelay);
  }

  async function poll(t: WidgetTracker): Promise<void> {
    if (stopped) {
      return;
    }
    try {
      const widget = await source.getWidget(dashboardId, t.widgetId);
      if (stopped) {
        return;
      }
      const nextDelay = handleWidget(t, widget, now(), opts, callbacks);
      schedule(t, nextDelay);
    } catch (err) {
      if (stopped) {
        return;
      }
      callbacks.onError?.(err);
      schedule(t, opts.failingBackoffMs);
    }
  }

  async function bootstrap(): Promise<void> {
    try {
      const widgets = await source.getWidgets(dashboardId);
      if (stopped) {
        return;
      }
      bootstrapAttempts = 0;
      bootstrapRetryDelayMs = 0;
      for (const widget of widgets) {
        applyWidget(widget);
      }
      settleBootstrap();
    } catch (err) {
      if (stopped) {
        return;
      }
      bootstrapAttempts += 1;
      if (bootstrapAttempts >= opts.bootstrapErrorAfterAttempts) {
        settleBootstrap();
        callbacks.onError?.(err);
      }
      bootstrapRetryDelayMs =
        bootstrapRetryDelayMs === 0
          ? opts.bootstrapRetryStartMs
          : Math.min(bootstrapRetryDelayMs * 2, opts.bootstrapRetryMaxMs);
      if (bootstrapRetryHandle !== null) {
        clearTimer(bootstrapRetryHandle);
      }
      bootstrapRetryHandle = setTimer(() => {
        bootstrapRetryHandle = null;
        if (!stopped) {
          void bootstrap();
        }
      }, bootstrapRetryDelayMs);
    }
  }

  if (visibility) {
    visibilityCleanup = visibility.onChange(() => {
      if (stopped) {
        return;
      }
      if (visibility.isHidden()) {
        for (const t of trackers.values()) {
          if (t.timer !== null) {
            clearTimer(t.timer);
            t.timer = null;
          }
        }
      } else {
        for (const t of trackers.values()) {
          schedule(t, 0);
        }
      }
    });
  }

  void bootstrap();

  return () => {
    stopped = true;
    for (const t of trackers.values()) {
      if (t.timer !== null) {
        clearTimer(t.timer);
        t.timer = null;
      }
    }
    if (bootstrapRetryHandle !== null) {
      clearTimer(bootstrapRetryHandle);
      bootstrapRetryHandle = null;
    }
    if (visibilityCleanup) {
      visibilityCleanup();
    }
  };
}

export function handleWidget(
  t: WidgetTracker,
  widget: CachedWidget,
  nowMs: number,
  opts: ResolvedOptions,
  callbacks: SubscribeCallbacks,
): number {
  const incomingSyncAtMs = widget.cachedAt
    ? new Date(widget.cachedAt).getTime()
    : null;
  const rawIntervalSeconds =
    widget.syncIntervalSeconds ?? opts.defaultIntervalSeconds;
  const safeIntervalSeconds =
    Number.isFinite(rawIntervalSeconds) && rawIntervalSeconds > 0
      ? rawIntervalSeconds
      : opts.defaultIntervalSeconds;
  const intervalMs = safeIntervalSeconds * 1000;
  const state = widget.syncState;

  const previousSyncAtMs = t.lastSyncAtMs;
  const advanced =
    incomingSyncAtMs !== null && incomingSyncAtMs !== previousSyncAtMs;

  switch (state) {
    case 'fresh': {
      if (advanced || previousSyncAtMs === null) {
        t.lastSyncAtMs = incomingSyncAtMs;
        t.lastSyncState = state;
        t.failingNotified = false;
        t.lateRetryDelayMs = null;
        t.syncingSinceMs = null;
        callbacks.onWidgetUpdated(widget);
        if (incomingSyncAtMs === null) {
          return intervalMs;
        }
        const expected = incomingSyncAtMs + intervalMs;
        return Math.max(0, expected - nowMs);
      }
      callbacks.onWidgetUnchanged?.(widget);
      const expected = (incomingSyncAtMs ?? nowMs) + intervalMs;
      const baseDelay = Math.max(0, expected - nowMs);
      const giveUpAtMs = (incomingSyncAtMs ?? nowMs) + 2 * intervalMs;
      if (nowMs >= giveUpAtMs) {
        t.lateRetryDelayMs = null;
        return Math.max(baseDelay, intervalMs);
      }
      const prev = t.lateRetryDelayMs ?? 0;
      const next =
        prev === 0
          ? opts.lateRetryStartMs
          : Math.min(prev * 2, opts.lateRetryMaxMs);
      t.lateRetryDelayMs = next;
      t.lastSyncState = state;
      return next;
    }
    case 'syncing': {
      t.lastSyncState = state;
      if (t.syncingSinceMs === null) {
        t.syncingSinceMs = nowMs;
      }
      callbacks.onWidgetUnchanged?.(widget);
      const elapsed = nowMs - t.syncingSinceMs;
      if (elapsed >= opts.syncingPollMaxMs) {
        return intervalMs;
      }
      return opts.syncingPollMs;
    }
    case 'failing':
    case 'stale': {
      t.lastSyncState = state;
      if (!t.failingNotified) {
        t.failingNotified = true;
        callbacks.onWidgetFailing?.(widget);
      } else {
        callbacks.onWidgetUnchanged?.(widget);
      }
      return opts.failingBackoffMs;
    }
    case 'unsynced': {
      t.lastSyncState = state;
      callbacks.onWidgetUnchanged?.(widget);
      return opts.unsyncedPollMs;
    }
    default: {
      if (advanced || previousSyncAtMs === null) {
        t.lastSyncAtMs = incomingSyncAtMs;
        callbacks.onWidgetUpdated(widget);
      } else {
        callbacks.onWidgetUnchanged?.(widget);
      }
      t.lastSyncState = state;
      return intervalMs;
    }
  }
}

function defaultVisibility(): VisibilitySource | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const doc = document;
  return {
    isHidden: () => doc.hidden === true,
    onChange: (listener) => {
      const handler = () => listener();
      doc.addEventListener('visibilitychange', handler);
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', handler);
      }
      return () => {
        doc.removeEventListener('visibilitychange', handler);
        if (typeof window !== 'undefined') {
          window.removeEventListener('focus', handler);
        }
      };
    },
  };
}
