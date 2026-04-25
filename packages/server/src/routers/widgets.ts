import type { DashboardConfig, Widget, WidgetEntry } from '@rawdash/core';
import type { Hono } from 'hono';

import { computeMetric } from '../compute';
import type { RawdashRouter } from '../router';
import type { ServerStorage } from '../types';

function flattenWidgets(
  config: DashboardConfig,
): Array<{ id: string; widget: Widget }> {
  const entries: Array<{ id: string; widget: Widget }> = [];
  for (const [dashboardKey, dashboard] of Object.entries(config.dashboards)) {
    for (const [widgetKey, widget] of Object.entries(dashboard.widgets)) {
      entries.push({ id: `${dashboardKey}:${widgetKey}`, widget });
    }
  }
  return entries;
}

export class WidgetsRouter implements RawdashRouter {
  constructor(
    private config: DashboardConfig,
    private storage: ServerStorage,
  ) {}

  private async resolveWidget(
    id: string,
    widget: Widget,
  ): Promise<WidgetEntry | undefined> {
    const { connectorId } = widget.metric;
    const connectorEntry = this.config.connectors.find(
      (e) => e.connector.id === connectorId,
    );
    if (!connectorEntry) {
      return undefined;
    }
    const handle = this.storage.getStorageHandle(connectorId);
    const data = await computeMetric(handle, widget.metric);
    return {
      id,
      widgetId: id,
      connectorId,
      data,
      cachedAt: (await this.storage.getSyncState()).lastSyncAt,
    };
  }

  mount(app: Hono): void {
    app.get('/widgets', async (c) => {
      const flat = flattenWidgets(this.config);
      const resolved = await Promise.all(
        flat.map(({ id, widget }) => this.resolveWidget(id, widget)),
      );
      const widgets = resolved.filter((w): w is WidgetEntry => w !== undefined);
      return c.json(widgets);
    });

    app.get('/widgets/:id', async (c) => {
      const input = c.req.param('id');
      const flat = flattenWidgets(this.config);
      const entry = flat.find((e) => e.id === input);
      if (!entry) {
        return c.json({ error: 'Widget not found' }, 404);
      }
      const widget = await this.resolveWidget(entry.id, entry.widget);
      if (!widget) {
        return c.json({ error: 'Widget not found' }, 404);
      }
      return c.json(widget);
    });
  }
}
