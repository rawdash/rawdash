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
      const body = (await c.req.json()) as Partial<DashboardConfig>;
      if (
        !body ||
        typeof body !== 'object' ||
        !Array.isArray(body.connectors) ||
        !body.dashboards ||
        typeof body.dashboards !== 'object'
      ) {
        return c.json(
          { error: 'Body must be a config with "connectors" and "dashboards"' },
          400,
        );
      }
      return c.json(validateConfigMetrics(body as DashboardConfig, resources));
    } catch (err) {
      return mapError(c, err);
    }
  });
  return app;
}
