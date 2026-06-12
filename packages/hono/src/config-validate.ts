import type { ConnectorRegistry, DashboardConfig } from '@rawdash/core';
import {
  resourcesByConnectorIdFromRegistry,
  validateConfigMetrics,
} from '@rawdash/core';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { applyBefore, mapError } from './shared';

export interface ConfigValidateRouterOptions {
  connectorRegistry: ConnectorRegistry;
  before?: MiddlewareHandler[];
}

export function createConfigValidateRouter(
  opts: ConfigValidateRouterOptions,
): Hono {
  const app = new Hono();
  applyBefore(app, opts.before);
  const resources = resourcesByConnectorIdFromRegistry(opts.connectorRegistry);
  app.post('/', async (c) => {
    try {
      const config = (await c.req.json()) as DashboardConfig;
      return c.json(validateConfigMetrics(config, resources));
    } catch (err) {
      return mapError(c, err);
    }
  });
  return app;
}
