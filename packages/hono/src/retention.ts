import type { DashboardConfig, ServerStorage } from '@rawdash/server';
import {
  DEFAULT_RETENTION_INTERVAL_MS,
  hasPruningPolicy,
  runRetention,
  runRetentionOnce,
} from '@rawdash/server';
import { Hono } from 'hono';

import type { HonoRouterOptions } from './shared';
import { applyBefore, makeEngineContext, mapError } from './shared';

/**
 * `POST /retain` — runs the retention policy once. Coalesces concurrent
 * calls so multiple requests during an in-flight run share the same
 * promise.
 *
 * Mount at `/retention`.
 */
export function createRetentionRouter(opts: HonoRouterOptions): Hono {
  const app = new Hono();
  applyBefore(app, opts.before);

  let inFlight: Promise<void> | null = null;

  app.post('/retain', async (c) => {
    try {
      if (!inFlight) {
        const ctx = makeEngineContext(c, opts);
        inFlight = runRetentionOnce(ctx).finally(() => {
          inFlight = null;
        });
      }
      await inFlight;
      return c.json({ triggered: true });
    } catch (err) {
      console.error('retention run failed', err);
      return mapError(c, err);
    }
  });

  return app;
}

export interface RetentionLoopOptions {
  getConfig: () => DashboardConfig | Promise<DashboardConfig>;
  getStorage: () => ServerStorage | Promise<ServerStorage>;
  intervalMs?: number;
}

/**
 * Start a background loop that periodically runs the retention policy.
 * Returns a `stop()` function that clears the interval.
 *
 * Only useful on long-lived runtimes (Node, Bun, Deno). In serverless
 * runtimes (Workers, Lambda) use the platform's native scheduler
 * (Cron Triggers, CloudWatch Events) to call `POST /retention/retain`.
 */
export function startRetentionLoop(opts: RetentionLoopOptions): () => void {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    if (inFlight || stopped) {
      return;
    }
    const config = await opts.getConfig();
    if (!config.retention || !hasPruningPolicy(config.retention)) {
      return;
    }
    const storage = await opts.getStorage();
    inFlight = runRetention(config, storage).finally(() => {
      inFlight = null;
    });
    try {
      await inFlight;
    } catch (err) {
      console.error('retention run failed', err);
    }
  };

  void (async () => {
    const config = await opts.getConfig();
    if (!config.retention || !hasPruningPolicy(config.retention)) {
      return;
    }
    const intervalMs =
      opts.intervalMs ??
      config.retention.intervalMs ??
      DEFAULT_RETENTION_INTERVAL_MS;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
  })();

  return () => {
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
