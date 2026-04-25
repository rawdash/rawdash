import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { InMemoryStorage } from '../storage';
import { WidgetsRouter } from './widgets';

const CONNECTOR_ID = 'test';

const mockConnector = {
  id: CONNECTOR_ID,
  async sync() {},
};

const config = {
  connectors: [{ connector: mockConnector }],
  dashboards: {
    main: {
      widgets: {
        my_widget: {
          metric: {
            connectorId: CONNECTOR_ID,
            shape: 'event' as const,
            name: 'run',
            field: 'start_ts',
            fn: 'count' as const,
          },
        },
      },
    },
  },
};

function makeApp(storage: InMemoryStorage): Hono {
  const app = new Hono();
  new WidgetsRouter(
    'main',
    config.dashboards.main,
    config.connectors,
    storage,
  ).mount(app);
  return app;
}

describe('WidgetsRouter — cachedAt', () => {
  it('GET /dashboards/main/widgets returns cachedAt: null before any sync', async () => {
    const storage = new InMemoryStorage();
    const app = makeApp(storage);
    const res = await app.request('/dashboards/main/widgets');
    const widgets = (await res.json()) as Array<{ cachedAt: string | null }>;
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.cachedAt).toBeNull();
  });

  it('GET /dashboards/main/widgets/:widgetId returns cachedAt: null before any sync', async () => {
    const storage = new InMemoryStorage();
    const app = makeApp(storage);
    const res = await app.request('/dashboards/main/widgets/my_widget');
    const widget = (await res.json()) as { cachedAt: string | null };
    expect(widget.cachedAt).toBeNull();
  });

  it('GET /dashboards/main/widgets returns non-null cachedAt after setSyncSuccess', async () => {
    const storage = new InMemoryStorage();
    const app = makeApp(storage);
    await storage.setSyncSuccess();
    const res = await app.request('/dashboards/main/widgets');
    const widgets = (await res.json()) as Array<{ cachedAt: string | null }>;
    const cachedAt = widgets[0]!.cachedAt;
    expect(cachedAt).not.toBeNull();
    expect(new Date(cachedAt!).toISOString()).toBe(cachedAt);
  });

  it('cachedAt is stable across multiple reads before any sync', async () => {
    const storage = new InMemoryStorage();
    const app = makeApp(storage);
    const res1 = await app.request('/dashboards/main/widgets');
    const res2 = await app.request('/dashboards/main/widgets');
    const w1 = (await res1.json()) as Array<{ cachedAt: string | null }>;
    const w2 = (await res2.json()) as Array<{ cachedAt: string | null }>;
    expect(w1[0]!.cachedAt).toBeNull();
    expect(w2[0]!.cachedAt).toBeNull();
  });
});
