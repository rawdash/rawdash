import { describe, expect, it } from 'vitest';

import { secret } from './secrets';
import { toWireConfig } from './wire-config';

describe('toWireConfig()', () => {
  it('maps declarative connector entries to the wire shape', () => {
    const result = toWireConfig({
      connectors: [
        {
          name: 'main',
          connectorId: 'stub',
          config: {
            host: 'example.com',
            port: 443,
            token: secret('API_TOKEN'),
          },
        },
      ],
      dashboards: {},
    });

    expect(result.connectors).toHaveLength(1);
    const c = result.connectors![0]!;
    expect(c.name).toBe('main');
    expect(c.connectorId).toBe('stub');
    expect(c.displayName).toBe('main');
    expect(c.enabled).toBe(true);
    expect(c.syncIntervalSeconds).toBe(300);
  });

  it('preserves secret refs in connector config', () => {
    const result = toWireConfig({
      connectors: [
        {
          name: 'main',
          connectorId: 'stub',
          config: {
            host: 'example.com',
            port: 443,
            token: secret('API_TOKEN'),
          },
        },
      ],
      dashboards: {},
    });

    expect(result.connectors![0]!.config).toEqual({
      host: 'example.com',
      port: 443,
      token: { $secret: 'API_TOKEN' },
    });
  });

  it('passes through user overrides for displayName/enabled/syncIntervalSeconds', () => {
    const result = toWireConfig({
      connectors: [
        {
          name: 'main',
          connectorId: 'stub',
          config: { host: 'a.com' },
          displayName: 'Main API',
          enabled: false,
          syncIntervalSeconds: 60,
        },
      ],
      dashboards: {},
    });

    expect(result.connectors![0]!.displayName).toBe('Main API');
    expect(result.connectors![0]!.enabled).toBe(false);
    expect(result.connectors![0]!.syncIntervalSeconds).toBe(60);
  });

  it('maps dashboards from Record to Array with id/name/slug', () => {
    const result = toWireConfig({
      connectors: [],
      dashboards: {
        github: {
          widgets: {
            stars: {
              kind: 'stat',
              title: 'Stars',
              metric: {
                connectorId: 'stub',
                shape: 'entity',
                name: 'repo',
                field: 'stars',
                fn: 'latest',
              },
            },
          },
        },
      },
    });

    expect(result.dashboards).toHaveLength(1);
    const d = result.dashboards![0]!;
    expect(d.id).toBe('github');
    expect(d.name).toBe('github');
    expect(d.slug).toBe('github');
    expect(d.config).toHaveProperty('widgets.stars.kind', 'stat');
  });

  it('handles multiple connectors and dashboards', () => {
    const result = toWireConfig({
      connectors: [
        { name: 'a', connectorId: 'stub', config: { host: 'a.com' } },
        { name: 'b', connectorId: 'stub', config: { host: 'b.com' } },
      ],
      dashboards: {
        dash1: { widgets: {} },
        dash2: { widgets: {} },
      },
    });

    expect(result.connectors).toHaveLength(2);
    expect(result.dashboards).toHaveLength(2);
  });

  it('produces empty arrays for empty config', () => {
    const result = toWireConfig({ connectors: [], dashboards: {} });
    expect(result.connectors).toEqual([]);
    expect(result.dashboards).toEqual([]);
  });
});
