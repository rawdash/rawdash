import { describe, expect, it } from 'vitest';

import { defineConfig, defineDashboard, defineMetric } from './config';
import type { DashboardConfig } from './config';
import type { ConnectorRegistry } from './registry';
import { defineResources } from './resource';
import type { ResourcesByConnectorId } from './validate-metrics';
import {
  resourcesByConnectorIdFromRegistry,
  validateConfigMetrics,
} from './validate-metrics';

const acmeResources = defineResources({
  acme_active_users: {
    shape: 'metric',
    description: 'Daily active users.',
    unit: 'users',
    dimensions: [{ name: 'window', description: 'dau, wau, or mau.' }],
  },
  acme_charge: {
    shape: 'event',
    description: 'Charge attempts.',
    filterable: [],
    fields: [
      { name: 'amount', description: 'Amount in cents.', unit: 'cents' },
      { name: 'status', description: 'Charge status.' },
    ],
  },
  acme_subscription: {
    shape: 'entity',
    description: 'Subscriptions.',
    filterable: [],
    fields: [{ name: 'status', description: 'Subscription status.' }],
  },
});

const resourcesByConnectorId: ResourcesByConnectorId = { acme: acmeResources };

const acme = { name: 'acme', connectorId: 'acme', config: {} };

function configWith(metric: ReturnType<typeof defineMetric>): DashboardConfig {
  return defineConfig({
    connectors: [acme],
    dashboards: {
      main: defineDashboard({
        widgets: {
          w: { kind: 'stat', title: 'W', metric },
        },
      }),
    },
  });
}

describe('validateConfigMetrics', () => {
  it('passes a valid config', () => {
    const config = configWith(
      defineMetric({
        connector: acme,
        shape: 'entity',
        entityType: 'acme_subscription',
        fn: 'count',
        filter: [{ field: 'status', op: 'eq', value: 'active' }],
      }),
    );
    const { errors, warnings } = validateConfigMetrics(
      config,
      resourcesByConnectorId,
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('rejects a nonexistent field with the valid options listed', () => {
    const config = configWith(
      defineMetric({
        connector: acme,
        shape: 'metric',
        name: 'acme_active_users',
        field: 'count',
        fn: 'sum',
      }),
    );
    const { errors } = validateConfigMetrics(config, resourcesByConnectorId);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('field "count" is not a field');
    expect(errors[0]?.message).toContain('window');
    expect(errors[0]?.message).toContain('value');
  });

  it('rejects an unknown resource name', () => {
    const config = configWith(
      defineMetric({
        connector: acme,
        shape: 'metric',
        name: 'acme_nope',
        field: 'value',
        fn: 'sum',
      }),
    );
    const { errors } = validateConfigMetrics(config, resourcesByConnectorId);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('unknown metric "acme_nope"');
    expect(errors[0]?.message).toContain('acme_active_users');
  });

  it('rejects a shape mismatch', () => {
    const config = configWith(
      defineMetric({
        connector: acme,
        shape: 'metric',
        name: 'acme_charge',
        field: 'value',
        fn: 'sum',
      }),
    );
    const { errors } = validateConfigMetrics(config, resourcesByConnectorId);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('declares shape "metric"');
    expect(errors[0]?.message).toContain('is a "event"');
  });

  it('warns when summing a cents field without conversion', () => {
    const config = configWith(
      defineMetric({
        connector: acme,
        shape: 'event',
        name: 'acme_charge',
        field: 'amount',
        fn: 'sum',
      }),
    );
    const { errors, warnings } = validateConfigMetrics(
      config,
      resourcesByConnectorId,
    );
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('cents');
    expect(warnings[0]?.message).toContain('100x');
  });

  it.each(['avg', 'min', 'max'] as const)(
    'warns when %sing a cents field without conversion',
    (fn) => {
      const config = configWith(
        defineMetric({
          connector: acme,
          shape: 'event',
          name: 'acme_charge',
          field: 'amount',
          fn,
        }),
      );
      const { warnings } = validateConfigMetrics(
        config,
        resourcesByConnectorId,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain('cents');
    },
  );

  it('rejects an invalid filter field', () => {
    const config = configWith(
      defineMetric({
        connector: acme,
        shape: 'event',
        name: 'acme_charge',
        fn: 'count',
        filter: [{ field: 'nope', op: 'eq', value: 'x' }],
      }),
    );
    const { errors } = validateConfigMetrics(config, resourcesByConnectorId);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('filter field "nope"');
  });

  it('rejects an invalid groupBy field', () => {
    const config = configWith(
      defineMetric({
        connector: acme,
        shape: 'event',
        name: 'acme_charge',
        field: 'amount',
        fn: 'count',
        groupBy: { field: 'nope', granularity: 'day' },
      }),
    );
    const { errors } = validateConfigMetrics(config, resourcesByConnectorId);
    expect(errors.some((e) => e.message.includes('groupBy field "nope"'))).toBe(
      true,
    );
  });

  it('warns when a windowed-looking metric has groupBy but no window', () => {
    const config = defineConfig({
      connectors: [acme],
      dashboards: {
        main: defineDashboard({
          widgets: {
            charges_30d: {
              kind: 'stat',
              title: 'Charges (30d)',
              metric: defineMetric({
                connector: acme,
                shape: 'event',
                name: 'acme_charge',
                field: 'amount',
                fn: 'count',
                groupBy: { field: 'start_ts', granularity: 'day' },
              }),
            },
          },
        }),
      },
    });
    const { warnings } = validateConfigMetrics(config, resourcesByConnectorId);
    expect(warnings.some((w) => w.message.includes('time window'))).toBe(true);
  });

  it('does not warn on count over a cents field', () => {
    const config = configWith(
      defineMetric({
        connector: acme,
        shape: 'event',
        name: 'acme_charge',
        field: 'amount',
        fn: 'count',
      }),
    );
    const { warnings } = validateConfigMetrics(config, resourcesByConnectorId);
    expect(warnings).toEqual([]);
  });

  it('warns when a windowed-looking metric has no window', () => {
    const config = defineConfig({
      connectors: [acme],
      dashboards: {
        main: defineDashboard({
          widgets: {
            charges_30d: {
              kind: 'stat',
              title: 'Charges (30d)',
              metric: defineMetric({
                connector: acme,
                shape: 'event',
                name: 'acme_charge',
                field: 'status',
                fn: 'count',
              }),
            },
          },
        }),
      },
    });
    const { warnings } = validateConfigMetrics(config, resourcesByConnectorId);
    expect(warnings.some((w) => w.message.includes('time window'))).toBe(true);
  });

  it('does not warn about a window when one is set', () => {
    const config = defineConfig({
      connectors: [acme],
      dashboards: {
        main: defineDashboard({
          widgets: {
            charges_30d: {
              kind: 'stat',
              title: 'Charges (30d)',
              metric: defineMetric({
                connector: acme,
                shape: 'event',
                name: 'acme_charge',
                field: 'status',
                fn: 'count',
                window: '30d',
              }),
            },
          },
        }),
      },
    });
    const { warnings } = validateConfigMetrics(config, resourcesByConnectorId);
    expect(warnings).toEqual([]);
  });

  it('skips validation for connectors with no registered resources', () => {
    const config = configWith(
      defineMetric({
        connector: acme,
        shape: 'metric',
        name: 'whatever',
        field: 'nope',
        fn: 'sum',
      }),
    );
    const { errors, warnings } = validateConfigMetrics(config, {});
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('ignores status widgets', () => {
    const config = defineConfig({
      connectors: [acme],
      dashboards: {
        main: defineDashboard({
          widgets: {
            s: { kind: 'status', title: 'S', source: 'acme' },
          },
        }),
      },
    });
    const { errors } = validateConfigMetrics(config, resourcesByConnectorId);
    expect(errors).toEqual([]);
  });
});

describe('resourcesByConnectorIdFromRegistry', () => {
  it('extracts resources from each connector class, skipping those without', () => {
    const registry = {
      acme: { resources: acmeResources },
      bare: {},
    } as unknown as ConnectorRegistry;
    const resources = resourcesByConnectorIdFromRegistry(registry);
    expect(Object.keys(resources)).toEqual(['acme']);
    expect(resources.acme).toBe(acmeResources);
  });
});
