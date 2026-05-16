import type {
  ConnectorEntry,
  Dashboard,
  Widget,
  WidgetEntry,
} from '@rawdash/core';
import { resolveWidget } from '@rawdash/core';
import type { Hono } from 'hono';

import type { RawdashRouter } from '../router';
import type { ServerStorage } from '../types';

export class WidgetsRouter implements RawdashRouter {
  constructor(
    private dashboardId: string,
    private dashboard: Dashboard,
    private connectors: ConnectorEntry[],
    private storage: ServerStorage,
  ) {}

  private resolve(
    id: string,
    widget: Widget,
  ): Promise<WidgetEntry | undefined> {
    return resolveWidget(id, widget, this.connectors, this.storage);
  }

  mount(app: Hono): void {
    const base = `/dashboards/${this.dashboardId}/widgets`;

    app.get(base, async (c) => {
      const entries = Object.entries(this.dashboard.widgets);
      const resolved = await Promise.all(
        entries.map(([key, widget]) => this.resolve(key, widget)),
      );
      const widgets = resolved.filter((w): w is WidgetEntry => w !== undefined);
      return c.json(widgets);
    });

    app.get(`${base}/:widgetId`, async (c) => {
      const widgetId = c.req.param('widgetId');
      const widget = this.dashboard.widgets[widgetId];
      if (!widget) {
        return c.json({ error: 'Widget not found' }, 404);
      }
      const result = await this.resolve(widgetId, widget);
      if (!result) {
        return c.json({ error: 'Widget not found' }, 404);
      }
      return c.json(result);
    });
  }
}
