import type { WidgetCache } from '@rawdash/server';
import { getWidget, listWidgets } from '@rawdash/server';
import type { Context } from 'hono';
import { Hono } from 'hono';

import type { HonoRouterOptions } from './shared';
import { applyBefore, makeEngineContext, mapError } from './shared';

export interface HonoWidgetsRouterOptions extends HonoRouterOptions {
  cache?: (c: Context) => WidgetCache;
}

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
      if (result.etag) {
        c.header('ETag', result.etag);
      }
      return c.json(result.widget);
    } catch (err) {
      return mapError(c, err);
    }
  });

  return app;
}
