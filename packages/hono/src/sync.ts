import { getSyncStateHandler, triggerSync } from '@rawdash/server';
import { Hono } from 'hono';

import type { HonoRouterOptions, HonoStorageRouterOptions } from './shared';
import { applyBefore, makeEngineContext, mapError } from './shared';

/**
 * `POST /` — triggers a sync, returning immediately with
 * `{queued: true|false}`. The sync runs in the background.
 *
 * Mount at `/sync`.
 */
export function createSyncRouter(opts: HonoRouterOptions): Hono {
  const app = new Hono();
  applyBefore(app, opts.before);
  app.post('/', async (c) => {
    try {
      return c.json(await triggerSync(makeEngineContext(c, opts)));
    } catch (err) {
      return mapError(c, err);
    }
  });
  return app;
}

/**
 * `GET /` — returns the current `SyncState`. Mount at `/sync/state`.
 */
export function createSyncStateRouter(opts: HonoStorageRouterOptions): Hono {
  const app = new Hono();
  applyBefore(app, opts.before);
  app.get('/', async (c) => {
    try {
      // sync-state only needs storage, but reuse the EngineContext shape
      // for handler uniformity. getConfig is a no-op here.
      return c.json(
        await getSyncStateHandler({
          getConfig: () => {
            throw new Error('getConfig should not be called by sync-state');
          },
          getStorage: () => opts.getStorage(c),
        }),
      );
    } catch (err) {
      return mapError(c, err);
    }
  });
  return app;
}
