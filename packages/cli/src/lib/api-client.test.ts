import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postConfig } from './api-client';

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
        connectors: [
          { name: 'stub', connectorId: 'stub', config: { host: 'a.com' } },
        ],
        dashboards: {},
      },
      true,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
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
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ error: 'bad key' }),
    } as Response);

    const result = await postConfig({ connectors: [], dashboards: {} }, true);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.status).toBe(401);
    expect(result.error).toContain('API key invalid');
  });

  it('shows the scope message only for a 403 with code insufficient_scope', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          error: 'missing scope',
          code: 'insufficient_scope',
          required: 'config:write',
        }),
    } as Response);

    const result = await postConfig({ connectors: [], dashboards: {} }, true);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.status).toBe(403);
    expect(result.error).toContain('config:write');
    expect(result.error).toContain('scope');
  });

  it('surfaces the server message and URL for a non-scope 403', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({ error: 'unknown org', code: 'org_not_found' }),
    } as Response);

    const result = await postConfig({ connectors: [], dashboards: {} }, true);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.status).toBe(403);
    expect(result.error).not.toContain('config:write');
    expect(result.error).toContain('unknown org');
    expect(result.error).toContain('org_not_found');
    expect(result.error).toContain('https://api.example.test/config');
  });

  it('hints about a missing org slug on a slug-less 403', async () => {
    process.env['RAWDASH_URL'] = 'https://api.rawdash.dev';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ error: 'forbidden' }),
    } as Response);

    const result = await postConfig({ connectors: [], dashboards: {} }, true);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain('org slug');
  });

  it('does not hint about a slug when the URL already has one', async () => {
    process.env['RAWDASH_URL'] = 'https://api.rawdash.dev/my-org';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({ error: 'forbidden', code: 'insufficient_role' }),
    } as Response);

    const result = await postConfig({ connectors: [], dashboards: {} }, true);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).not.toContain('org slug');
    expect(result.error).toContain('insufficient_role');
  });

  it('returns DeployFailure on network error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('connection refused'));

    const result = await postConfig({ connectors: [], dashboards: {} }, true);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.status).toBe(0);
    expect(result.error).toContain('Network error');
  });
});
