import type { ConnectorRegistry, DashboardConfig } from '@rawdash/core';
import { defineResources } from '@rawdash/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createConfigValidateRouter } from './config-validate';

const resources = defineResources({
  acme_charge: {
    shape: 'event',
    description: 'Charges.',
    filterable: [],
    fields: [
      { name: 'amount', description: 'Amount in cents.', unit: 'cents' },
      { name: 'status', description: 'Charge status.' },
    ],
  },
});

const registry = {
  acme: { resources },
} as unknown as ConnectorRegistry;

function makeApp() {
  const app = new Hono();
  app.route(
    '/config/validate',
    createConfigValidateRouter({ connectorRegistry: registry }),
  );
  return app;
}

function configWith(
  metric: DashboardConfig['dashboards'][string]['widgets'][string],
) {
  return {
    connectors: [{ name: 'acme', connectorId: 'acme', config: {} }],
    dashboards: { main: { widgets: { w: metric } } },
  } satisfies DashboardConfig;
}

async function post(app: Hono, config: DashboardConfig) {
  const res = await app.request('/config/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res;
}

describe('createConfigValidateRouter', () => {
  it('returns no issues for a valid config', async () => {
    const app = makeApp();
    const res = await post(
      app,
      configWith({
        kind: 'stat',
        title: 'Charges',
        metric: {
          connectorId: 'acme',
          shape: 'event',
          name: 'acme_charge',
          fn: 'count',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ errors: [], warnings: [] });
  });

  it('reports an error for an unknown field', async () => {
    const app = makeApp();
    const res = await post(
      app,
      configWith({
        kind: 'stat',
        title: 'Bad',
        metric: {
          connectorId: 'acme',
          shape: 'event',
          name: 'acme_charge',
          field: 'nope',
          fn: 'latest',
        },
      }),
    );
    const body = (await res.json()) as {
      errors: { message: string }[];
      warnings: unknown[];
    };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.message).toContain('field "nope"');
  });

  it('warns when summing a cents field', async () => {
    const app = makeApp();
    const res = await post(
      app,
      configWith({
        kind: 'stat',
        title: 'Total',
        metric: {
          connectorId: 'acme',
          shape: 'event',
          name: 'acme_charge',
          field: 'amount',
          fn: 'sum',
        },
      }),
    );
    const body = (await res.json()) as {
      errors: unknown[];
      warnings: { message: string }[];
    };
    expect(body.errors).toEqual([]);
    expect(body.warnings[0]?.message).toContain('cents');
  });
});
