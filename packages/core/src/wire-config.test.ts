import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BaseConnector,
  type StorageHandle,
  type SyncOptions,
} from './connector';
import { secret } from './secrets';
import { toWireConfig } from './wire-config';

class StubConnector extends BaseConnector<
  { host: string; port: number },
  { token: { description: string; auth: 'optional' } }
> {
  static readonly id = 'stub';
  readonly id = 'stub';

  async sync(_req: SyncOptions, _storage: StorageHandle): Promise<void> {}
}

type NodeLike = { process?: { env?: Record<string, string | undefined> } };

describe('toWireConfig()', () => {
  const g = globalThis as unknown as NodeLike;
  g.process ??= { env: {} };
  const env = (g.process.env ??= {});
  const prevApiToken = env['API_TOKEN'];

  beforeAll(() => {
    env['API_TOKEN'] = 'test-secret-value';
  });

  afterAll(() => {
    if (prevApiToken === undefined) {
      delete env['API_TOKEN'];
    } else {
      env['API_TOKEN'] = prevApiToken;
    }
  });

  it('maps connectors to wire shape with id as name and connectorId', () => {
    const connector = new StubConnector(
      { host: 'example.com', port: 443 },
      { token: secret('API_TOKEN') },
    );

    const result = toWireConfig({
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

    const result = toWireConfig({
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

    const result = toWireConfig({
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
    const c1 = new StubConnector({ host: 'a.com', port: 80 });
    const c2 = new StubConnector({ host: 'b.com', port: 443 });

    const result = toWireConfig({
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
    const result = toWireConfig({ connectors: [], dashboards: {} });
    expect(result.connectors).toEqual([]);
    expect(result.dashboards).toEqual([]);
  });
});
