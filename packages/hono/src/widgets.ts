import { getWidget, listWidgets } from '@rawdash/server';
import { Hono } from 'hono';

import type { HonoRouterOptions } from './shared';
import { applyBefore, makeEngineContext, mapError } from './shared';

/**
 * - `GET /:dashboardId/widgets` → `WidgetsListResponse`
 * - `GET /:dashboardId/widgets/:widgetId` → `CachedWidget`
 *
 * Mount at `/dashboards`.
 */
export function createWidgetsRouter(opts: HonoRouterOptions): Hono {
  const app = new Hono();
  applyBefore(app, opts.before);

  app.get('/:dashboardId/widgets', async (c) => {
    try {
      return c.json(
        await listWidgets(
          makeEngineContext(c, opts),
          c.req.param('dashboardId'),
        ),
      );
    } catch (err) {
      return mapError(c, err);
    }
  });

  app.get('/:dashboardId/widgets/:widgetId', async (c) => {
    try {
      return c.json(
        await getWidget(
          makeEngineContext(c, opts),
          c.req.param('dashboardId'),
          c.req.param('widgetId'),
        ),
      );
    } catch (err) {
      return mapError(c, err);
    }
  });

  return app;
}
