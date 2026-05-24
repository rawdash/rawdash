import type { ConnectorRegistry, SecretsResolver } from '@rawdash/core';
import type { ConnectorLoggerFactory } from '@rawdash/server';
import { getSyncStateHandler, triggerSync } from '@rawdash/server';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import type { HonoRouterOptions, HonoStorageRouterOptions } from './shared';
import { applyBefore, mapError } from './shared';

/**
 * Options for `createSyncRouter`.
 *
 * `mode` defaults to `'in-process'`: the trigger handler kicks off
 * `runSync` in the background, iterating `config.connectors` and
 * instantiating each via `connectorRegistry`. In this mode both
 * `getConfig` and `connectorRegistry` are required.
 *
 * In `mode: 'deferred'`, the trigger handler only records the `queued`
 * transition; an external runner is responsible for `running →
 * succeeded/failed`. `getConfig` and `connectorRegistry` can be omitted
 * in this mode — useful when the deployment cannot materialize connector
 * implementations at request time (e.g. cloud, where the actual
 * `connector.sync(...)` call happens in a queue consumer worker).
 */
export type SyncRouterOptions =
  | (HonoRouterOptions & {
      mode?: 'in-process';
      connectorRegistry: ConnectorRegistry;
      secretsResolver?: SecretsResolver;
      loggerFactory?: ConnectorLoggerFactory;
    })
  | {
      mode: 'deferred';
      getStorage: HonoRouterOptions['getStorage'];
      getConfig?: HonoRouterOptions['getConfig'];
      before?: MiddlewareHandler[];
    };

/**
 * `POST /` — triggers a sync, returning immediately with
 * `{queued: true|false}`. In `mode: 'in-process'` (default) the sync
 * runs in the background; in `mode: 'deferred'` the handler only
 * persists the `queued` transition and the external runner takes it
 * from there.
 *
 * Mount at `/sync`.
 */
export function createSyncRouter(opts: SyncRouterOptions): Hono {
  const app = new Hono();
  applyBefore(app, opts.before);
  app.post('/', async (c) => {
    try {
      if (opts.mode === 'deferred') {
        const getConfig = opts.getConfig;
        return c.json(
          await triggerSync(
            {
              getStorage: () => opts.getStorage(c),
              getConfig: getConfig ? () => getConfig(c) : undefined,
            },
            { mode: 'deferred' },
          ),
        );
      }
      return c.json(
        await triggerSync({
          getStorage: () => opts.getStorage(c),
          getConfig: () => opts.getConfig(c),
          connectorRegistry: opts.connectorRegistry,
          secretsResolver: opts.secretsResolver,
          loggerFactory: opts.loggerFactory,
        }),
      );
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
