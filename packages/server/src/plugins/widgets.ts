import type { DashboardConfig, WidgetEntry } from '@rawdash/core';
import type { Hono } from 'hono';

import { computeMetric } from '../compute';
import type { RawdashPlugin } from '../plugin';
import type { InMemoryStorage } from '../storage';

export class WidgetsPlugin implements RawdashPlugin {
  constructor(
    private config: DashboardConfig,
    private storage: InMemoryStorage,
  ) {}

  private resolveWidget(input: string): WidgetEntry | undefined {
    const sep = input.lastIndexOf(':');
    const configKey = sep === -1 ? input : input.slice(sep + 1);
    const widget = Object.prototype.hasOwnProperty.call(
      this.config.widgets,
      configKey,
    )
      ? this.config.widgets[configKey]
      : undefined;
    if (!widget) {
      return undefined;
    }
    const { connectorId, resource } = widget.metric;
    const connectorEntry = this.config.connectors.find(
      (e) => e.connector.id === connectorId,
    );
    if (!connectorEntry) {
      return undefined;
    }
    const fields = connectorEntry.connector.resources[resource]?.fields;
    if (!fields) {
      return undefined;
    }
    const records = this.storage.getRecords(connectorId, resource);
    const data = computeMetric(records, widget.metric, fields);
    return {
      id: configKey,
      widgetId: input,
      connectorId,
      data,
      cachedAt:
        this.storage.getSyncState().lastSyncAt ?? new Date().toISOString(),
    };
  }

  mount(app: Hono): void {
    app.get('/widgets', (c) => {
      const widgets = Object.keys(this.config.widgets)
        .map((key) => this.resolveWidget(key))
        .filter((w): w is WidgetEntry => w !== undefined);
      return c.json(widgets);
    });

    app.get('/widgets/:id', (c) => {
      const widget = this.resolveWidget(c.req.param('id'));
      if (!widget) {
        return c.json({ error: 'Widget not found' }, 404);
      }
      return c.json(widget);
    });
  }
}
