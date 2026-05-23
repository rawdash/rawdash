import type { WidgetCache } from '@rawdash/server';
import { getWidget, listWidgets } from '@rawdash/server';
import type { Context } from 'hono';
import { Hono } from 'hono';

import type { HonoRouterOptions } from './shared';
import { applyBefore, makeEngineContext, mapError } from './shared';

export interface HonoWidgetsRouterOptions extends HonoRouterOptions {
  /**
   * Optional per-request factory returning a `WidgetCache`. Invoked once
   * per request so the cache can be scoped to the request's tenant/auth
   * context. When omitted, widgets are resolved fresh on every request.
   */
  cache?: (c: Context) => WidgetCache;
}

/**
 * - `GET /:dashboardId/widgets` → `WidgetsListResponse`
 * - `GET /:dashboardId/widgets/:widgetId` → `CachedWidget`
 *
 * Mount at `/dashboards`.
 */
export function createWidgetsRouter(opts: HonoWidgetsRouterOptions): Hono {
  const app = new Hono();
  applyBefore(app, opts.before);

  app.get('/:dashboardId/widgets', async (c) => {
    try {
      return c.json(
        await listWidgets(
          makeEngineContext(c, opts),
          c.req.param('dashboardId'),
          opts.cache?.(c),
        ),
      );
    } catch (err) {
      return mapError(c, err);
    }
  });

  app.get('/:dashboardId/widgets/:widgetId', async (c) => {
    try {
      const result = await getWidget(
        makeEngineContext(c, opts),
        c.req.param('dashboardId'),
        c.req.param('widgetId'),
        {
          cache: opts.cache?.(c),
          ifNoneMatch: c.req.header('if-none-match'),
        },
      );
      if (result.status === 'not-modified') {
        c.header('ETag', result.etag);
        return c.body(null, 304);
      }
      c.header('ETag', result.etag);
      return c.json(result.widget);
    } catch (err) {
      return mapError(c, err);
    }
  });

  return app;
}
