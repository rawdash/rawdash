import {
  BaseConnector,
  type StorageHandle,
  type SyncRequest,
} from '@rawdash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postConfig } from './api-client';

class StubConnector extends BaseConnector<
  { host: string },
  Record<string, never>
> {
  static readonly id = 'stub';
  readonly id = 'stub';

  async sync(_req: SyncRequest, _storage: StorageHandle): Promise<void> {}
}

const ORIG_FETCH = globalThis.fetch;

describe('postConfig()', () => {
  beforeEach(() => {
    process.env['RAWDASH_URL'] = 'https://api.example.test';
    process.env['RAWDASH_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
    delete process.env['RAWDASH_URL'];
    delete process.env['RAWDASH_API_KEY'];
    vi.restoreAllMocks();
  });

  it('wraps a cloud bucketed diff response as DeploySuccess', async () => {
    const cloudResponse = {
      connectors: {
        added: [
          {
            name: 'stub',
            connectorId: 'stub',
            config: { host: 'a.com' },
          },
        ],
        removed: [],
        modified: [],
      },
      dashboards: {
        added: [],
        removed: [],
        modified: [
          {
            id: 'github',
            name: 'github',
            slug: 'github',
            config: { widgets: {} },
          },
        ],
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => cloudResponse,
    } as Response);

    const result = await postConfig(
      {
        connectors: [{ connector: new StubConnector({ host: 'a.com' }) }],
        dashboards: {},
      },
      true,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {return;}
    expect(result.diff.connectors.added).toHaveLength(1);
    expect(result.diff.connectors.added[0]!.name).toBe('stub');
    expect(result.diff.dashboards.modified).toHaveLength(1);
    expect(result.diff.dashboards.modified[0]!.slug).toBe('github');
  });

  it('returns DeployFailure on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'bad key' }),
    } as Response);

    const result = await postConfig({ connectors: [], dashboards: {} }, true);

    expect(result.ok).toBe(false);
    if (result.ok) {return;}
    expect(result.status).toBe(401);
    expect(result.error).toContain('API key invalid');
  });

  it('returns DeployFailure on network error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('connection refused'));

    const result = await postConfig({ connectors: [], dashboards: {} }, true);

    expect(result.ok).toBe(false);
    if (result.ok) {return;}
    expect(result.status).toBe(0);
    expect(result.error).toContain('Network error');
  });
});
