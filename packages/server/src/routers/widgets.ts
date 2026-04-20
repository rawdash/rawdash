import type { DashboardConfig, WidgetEntry } from '@rawdash/core';
import type { Hono } from 'hono';

import { computeMetric } from '../compute';
import type { RawdashRouter } from '../router';
import type { ServerStorage } from '../types';

export class WidgetsRouter implements RawdashRouter {
  constructor(
    private config: DashboardConfig,
    private storage: ServerStorage,
  ) {}

  private async resolveWidget(
    configKey: string,
    widgetId: string = configKey,
  ): Promise<WidgetEntry | undefined> {
    const widget = Object.prototype.hasOwnProperty.call(
      this.config.widgets,
      configKey,
    )
      ? this.config.widgets[configKey]
      : undefined;
    if (!widget) {
      return undefined;
    }
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
      id: configKey,
      widgetId,
      connectorId,
      data,
      cachedAt: this.storage.getSyncState().lastSyncAt,
    };
  }

  mount(app: Hono): void {
    app.get('/widgets', async (c) => {
      const resolved = await Promise.all(
        Object.keys(this.config.widgets).map((key) => this.resolveWidget(key)),
      );
      const widgets = resolved.filter((w): w is WidgetEntry => w !== undefined);
      return c.json(widgets);
    });

    app.get('/widgets/:id', async (c) => {
      const input = c.req.param('id');
      const sep = input.lastIndexOf(':');
      const configKey = sep === -1 ? input : input.slice(sep + 1);
      const widget = await this.resolveWidget(configKey, input);
      if (!widget) {
        return c.json({ error: 'Widget not found' }, 404);
      }
      return c.json(widget);
    });
  }
}
