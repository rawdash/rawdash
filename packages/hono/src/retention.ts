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

export function startRetentionLoop(opts: RetentionLoopOptions): () => void {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    if (inFlight || stopped) {
      return;
    }
    try {
      const config = await opts.getConfig();
      if (!config.retention || !hasPruningPolicy(config.retention)) {
        return;
      }
      const storage = await opts.getStorage();
      inFlight = runRetention(config, storage).finally(() => {
        inFlight = null;
      });
      await inFlight;
    } catch (err) {
      console.error('retention run failed', err);
    }
  };

  void (async () => {
    try {
      const config = await opts.getConfig();
      if (!config.retention || !hasPruningPolicy(config.retention)) {
        return;
      }
      if (stopped) {
        return;
      }
      const intervalMs =
        opts.intervalMs ??
        config.retention.intervalMs ??
        DEFAULT_RETENTION_INTERVAL_MS;
      const created = setInterval(() => {
        void tick();
      }, intervalMs);
      if (stopped) {
        clearInterval(created);
      } else {
        timer = created;
      }
    } catch (err) {
      console.error('retention loop startup failed', err);
    }
  })();

  return () => {
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
