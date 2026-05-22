import type { DashboardConfig, ServerStorage } from '@rawdash/server';
import { InMemoryStorage } from '@rawdash/server';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createWidgetsRouter } from './widgets';

const CONNECTOR_ID = 'test';

const config: DashboardConfig = {
  connectors: [{ name: CONNECTOR_ID, connectorId: 'test', config: {} }],
  dashboards: {
    main: {
      widgets: {
        my_widget: {
          kind: 'stat',
          title: 'My Widget',
          metric: {
            connectorId: CONNECTOR_ID,
            shape: 'event',
            name: 'run',
            field: 'start_ts',
            fn: 'count',
          },
        },
      },
    },
  },
};

function makeApp(storage: ServerStorage): Hono {
  const app = new Hono();
  app.route(
    '/dashboards',
    createWidgetsRouter({
      getConfig: () => config,
      getStorage: () => storage,
    }),
  );
  return app;
}

describe('createWidgetsRouter', () => {
  it('GET /dashboards/main/widgets returns the widget list', async () => {
    const app = makeApp(new InMemoryStorage());
    const res = await app.request('/dashboards/main/widgets');
    expect(res.status).toBe(200);
    const { widgets } = (await res.json()) as {
      widgets: Array<{ cachedAt: string | null }>;
    };
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.cachedAt).toBeNull();
  });

  it('GET /dashboards/main/widgets/:widgetId returns the widget', async () => {
    const app = makeApp(new InMemoryStorage());
    const res = await app.request('/dashboards/main/widgets/my_widget');
    expect(res.status).toBe(200);
    const widget = (await res.json()) as { cachedAt: string | null };
    expect(widget.cachedAt).toBeNull();
  });

  it('GET unknown dashboard → 404 with structured error', async () => {
    const app = makeApp(new InMemoryStorage());
    const res = await app.request('/dashboards/ghost/widgets');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('DASHBOARD_NOT_FOUND');
  });

  it('GET unknown widget → 404 with structured error', async () => {
    const app = makeApp(new InMemoryStorage());
    const res = await app.request('/dashboards/main/widgets/ghost');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('WIDGET_NOT_FOUND');
  });

  it('cachedAt is populated after markSyncSucceeded', async () => {
    const storage = new InMemoryStorage();
    const app = makeApp(storage);
    await storage.markSyncSucceeded();
    const res = await app.request('/dashboards/main/widgets');
    const { widgets } = (await res.json()) as {
      widgets: Array<{ cachedAt: string | null }>;
    };
    expect(widgets[0]!.cachedAt).not.toBeNull();
  });
});
