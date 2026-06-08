import type { ConnectorRegistry, SecretsResolver } from '@rawdash/core';
import type { ConnectorLoggerFactory } from '@rawdash/server';
import { getSyncStateHandler, triggerSync } from '@rawdash/server';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import type { HonoRouterOptions, HonoStorageRouterOptions } from './shared';
import { applyBefore, mapError } from './shared';

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
