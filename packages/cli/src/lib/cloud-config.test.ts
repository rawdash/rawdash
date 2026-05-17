import {
  BaseConnector,
  type StorageHandle,
  type SyncOptions,
  secret,
} from '@rawdash/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toCloudConfig } from './cloud-config';

class StubConnector extends BaseConnector<
  { host: string; port: number },
  { token: { description: string; auth: 'optional' } }
> {
  static readonly id = 'stub';
  readonly id = 'stub';

  async sync(_req: SyncOptions, _storage: StorageHandle): Promise<void> {}
}

describe('toCloudConfig()', () => {
  const prevApiToken = process.env['API_TOKEN'];

  beforeAll(() => {
    process.env['API_TOKEN'] = 'test-secret-value';
  });

  afterAll(() => {
    if (prevApiToken === undefined) {
      delete process.env['API_TOKEN'];
    } else {
      process.env['API_TOKEN'] = prevApiToken;
    }
  });

  it('maps connectors to cloud shape with id as name and connectorId', () => {
    const connector = new StubConnector(
      { host: 'example.com', port: 443 },
      { token: secret('API_TOKEN') },
    );

    const result = toCloudConfig({
      connectors: [{ connector }],
      dashboards: {},
    });

    expect(result.connectors).toHaveLength(1);
    const c = result.connectors![0]!;
    expect(c.name).toBe('stub');
    expect(c.connectorId).toBe('stub');
    expect(c.displayName).toBe('stub');
    expect(c.enabled).toBe(true);
    expect(c.syncIntervalSeconds).toBe(300);
  });

  it('preserves secret refs in connector config', () => {
    const connector = new StubConnector(
      { host: 'example.com', port: 443 },
      { token: secret('API_TOKEN') },
    );

    const result = toCloudConfig({
      connectors: [{ connector }],
      dashboards: {},
    });

    expect(result.connectors![0]!.config).toEqual({
      host: 'example.com',
      port: 443,
      token: { $secret: 'API_TOKEN' },
    });
  });

  it('omits undefined credential fields from connector config', () => {
    const connector = new StubConnector(
      { host: 'example.com', port: 443 },
      { token: undefined },
    );

    const result = toCloudConfig({
      connectors: [{ connector }],
      dashboards: {},
    });

    expect(result.connectors![0]!.config).toEqual({
      host: 'example.com',
      port: 443,
    });
    expect('token' in result.connectors![0]!.config).toBe(false);
  });

  it('maps dashboards from Record to Array with id/name/slug', () => {
    const result = toCloudConfig({
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
    const c1 = new StubConnector({ host: 'a.com', port: 80 });
    const c2 = new StubConnector({ host: 'b.com', port: 443 });

    const result = toCloudConfig({
      connectors: [{ connector: c1 }, { connector: c2 }],
      dashboards: {
        dash1: { widgets: {} },
        dash2: { widgets: {} },
      },
    });

    expect(result.connectors).toHaveLength(2);
    expect(result.dashboards).toHaveLength(2);
  });

  it('produces empty arrays for empty config', () => {
    const result = toCloudConfig({ connectors: [], dashboards: {} });
    expect(result.connectors).toEqual([]);
    expect(result.dashboards).toEqual([]);
  });
});
