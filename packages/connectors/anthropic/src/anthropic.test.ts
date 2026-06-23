import {
  installFetchMockAdvanced,
  metricStoreFor,
  mockJsonResponse,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AnthropicConnector,
  type AnthropicResource,
  buildCostSamples,
  buildUsageSamples,
  configFields,
  getUsageWindow,
} from './anthropic';

const CONNECTOR_ID = 'anthropic';

function makeConnector(
  overrides: {
    workspaceIds?: readonly string[];
    lookbackDays?: number;
    resources?: readonly AnthropicResource[];
  } = {},
): AnthropicConnector {
  return new AnthropicConnector(
    {
      workspaceIds: overrides.workspaceIds,
      lookbackDays: overrides.lookbackDays ?? 7,
      resources: overrides.resources,
    },
    {
      adminApiKey: 'sk-ant-admin-test',
    },
  );
}

describe('AnthropicConnector sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches usage and cost reports and writes one sample per resource per row', async () => {
    const calls: string[] = [];
    installFetchMockAdvanced((url) => {
      calls.push(url);
      if (url.includes('/usage_report/messages')) {
        return {
          body: {
            data: [
              {
                starting_at: '2026-02-10T00:00:00Z',
                ending_at: '2026-02-11T00:00:00Z',
                results: [
                  {
                    account_id: null,
                    api_key_id: 'apikey_1',
                    cache_creation: {
                      ephemeral_1h_input_tokens: 100,
                      ephemeral_5m_input_tokens: 200,
                    },
                    cache_read_input_tokens: 4000,
                    context_window: '0-200k',
                    inference_geo: 'global',
                    model: 'claude-opus-4-6',
                    output_tokens: 800,
                    server_tool_use: { web_search_requests: 3 },
                    service_account_id: null,
                    service_tier: 'standard',
                    uncached_input_tokens: 1500,
                    workspace_id: 'wrkspc_A',
                  },
                ],
              },
            ],
            has_more: false,
            next_page: null,
          },
        };
      }
      return {
        body: {
          data: [
            {
              starting_at: '2026-02-10T00:00:00Z',
              ending_at: '2026-02-11T00:00:00Z',
              results: [
                {
                  amount: '123.45',
                  context_window: '0-200k',
                  cost_type: 'tokens',
                  currency: 'USD',
                  description: 'Claude Opus 4 Usage - Input Tokens',
                  inference_geo: 'global',
                  model: 'claude-opus-4-6',
                  service_tier: 'standard',
                  token_type: 'uncached_input_tokens',
                  workspace_id: 'wrkspc_A',
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        },
      };
    });

    const storage = new InMemoryStorage();
    const result = await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result).toEqual({ done: true });

    const metrics = metricStoreFor<{
      name: string;
      ts: number;
      value: number;
      attributes: Record<string, unknown>;
    }>(storage, CONNECTOR_ID);
    const byName = new Map<string, number>();
    for (const sample of metrics) {
      byName.set(sample.name, (byName.get(sample.name) ?? 0) + 1);
    }
    expect(byName.get('anthropic_input_tokens')).toBe(1);
    expect(byName.get('anthropic_output_tokens')).toBe(1);
    expect(byName.get('anthropic_cache_read_tokens')).toBe(1);
    expect(byName.get('anthropic_cache_creation_tokens')).toBe(1);
    expect(byName.get('anthropic_web_search_requests')).toBe(1);
    expect(byName.get('anthropic_cost_usd')).toBe(1);

    const input = metrics.find((m) => m.name === 'anthropic_input_tokens')!;
    expect(input.value).toBe(1500);
    expect(input.attributes['model']).toBe('claude-opus-4-6');
    expect(input.attributes['workspace_id']).toBe('wrkspc_A');

    const cacheCreation = metrics.find(
      (m) => m.name === 'anthropic_cache_creation_tokens',
    )!;
    expect(cacheCreation.value).toBe(300);
    expect(cacheCreation.attributes['ephemeral_1h_input_tokens']).toBe(100);
    expect(cacheCreation.attributes['ephemeral_5m_input_tokens']).toBe(200);

    const webSearch = metrics.find(
      (m) => m.name === 'anthropic_web_search_requests',
    )!;
    expect(webSearch.value).toBe(3);

    const cost = metrics.find((m) => m.name === 'anthropic_cost_usd')!;
    // amount "123.45" cents -> $1.2345
    expect(cost.value).toBeCloseTo(1.2345, 6);
    expect(cost.attributes['currency']).toBe('USD');
    expect(cost.attributes['token_type']).toBe('uncached_input_tokens');

    expect(calls.some((u) => u.includes('starting_at='))).toBe(true);
    expect(calls.some((u) => u.includes('bucket_width=1d'))).toBe(true);
    expect(calls.some((u) => u.includes('/usage_report/messages'))).toBe(true);
    expect(calls.some((u) => u.includes('/cost_report'))).toBe(true);
  });

  it('parses a partial cache_creation / server_tool_use object and writes 0 for the missing fields', async () => {
    installFetchMockAdvanced((url) => {
      if (url.includes('/usage_report/messages')) {
        return {
          body: {
            data: [
              {
                starting_at: '2026-02-10T00:00:00Z',
                ending_at: '2026-02-11T00:00:00Z',
                results: [
                  {
                    api_key_id: null,
                    cache_creation: { ephemeral_1h_input_tokens: 100 },
                    cache_read_input_tokens: 0,
                    model: 'claude-opus-4-6',
                    output_tokens: 10,
                    server_tool_use: {},
                    service_tier: 'standard',
                    uncached_input_tokens: 20,
                    workspace_id: null,
                  },
                ],
              },
            ],
            has_more: false,
            next_page: null,
          },
        };
      }
      return { body: { data: [], has_more: false, next_page: null } };
    });

    const storage = new InMemoryStorage();
    const result = await makeConnector({
      resources: [
        'anthropic_cache_creation_tokens',
        'anthropic_web_search_requests',
      ],
    }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
    expect(result).toEqual({ done: true });

    const metrics = metricStoreFor<{
      name: string;
      value: number;
      attributes: Record<string, unknown>;
    }>(storage, CONNECTOR_ID);

    const cacheCreation = metrics.find(
      (m) => m.name === 'anthropic_cache_creation_tokens',
    )!;
    expect(cacheCreation.value).toBe(100);
    expect(cacheCreation.attributes['ephemeral_1h_input_tokens']).toBe(100);
    expect(cacheCreation.attributes['ephemeral_5m_input_tokens']).toBe(0);

    const webSearch = metrics.find(
      (m) => m.name === 'anthropic_web_search_requests',
    )!;
    expect(webSearch.value).toBe(0);
  });

  it('paginates via has_more / next_page on usage_messages', async () => {
    const responses = [
      {
        data: [
          {
            starting_at: '2026-02-10T00:00:00Z',
            ending_at: '2026-02-11T00:00:00Z',
            results: [
              {
                api_key_id: null,
                cache_read_input_tokens: 0,
                model: 'claude-opus-4-6',
                output_tokens: 50,
                server_tool_use: null,
                service_tier: 'standard',
                uncached_input_tokens: 100,
                workspace_id: null,
              },
            ],
          },
        ],
        has_more: true,
        next_page: 'cursor_page_2',
      },
      {
        data: [
          {
            starting_at: '2026-02-11T00:00:00Z',
            ending_at: '2026-02-12T00:00:00Z',
            results: [
              {
                api_key_id: null,
                cache_read_input_tokens: 0,
                model: 'claude-opus-4-6',
                output_tokens: 90,
                server_tool_use: null,
                service_tier: 'standard',
                uncached_input_tokens: 200,
                workspace_id: null,
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      },
    ];

    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        if (!url.includes('/usage_report/messages')) {
          return Promise.resolve(
            mockJsonResponse({ data: [], has_more: false, next_page: null }),
          );
        }
        const usageCallNum = calls.filter((u) =>
          u.includes('/usage_report/messages'),
        ).length;
        return Promise.resolve(mockJsonResponse(responses[usageCallNum - 1]));
      }),
    );

    const storage = new InMemoryStorage();
    await makeConnector({
      resources: [
        'anthropic_input_tokens',
        'anthropic_output_tokens',
        'anthropic_cache_read_tokens',
        'anthropic_cache_creation_tokens',
        'anthropic_web_search_requests',
      ],
    }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    const usageCalls = calls.filter((u) =>
      u.includes('/usage_report/messages'),
    );
    expect(usageCalls).toHaveLength(2);
    expect(usageCalls[1]).toContain('page=cursor_page_2');

    const metrics = metricStoreFor<{ name: string; value: number }>(
      storage,
      CONNECTOR_ID,
    );
    const inputTokens = metrics
      .filter((m) => m.name === 'anthropic_input_tokens')
      .map((m) => m.value);
    expect(inputTokens).toEqual([100, 200]);
  });

  it('sends X-Api-Key and anthropic-version headers on every call', async () => {
    let lastInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        lastInit = init;
        return Promise.resolve(
          mockJsonResponse({ data: [], has_more: false, next_page: null }),
        );
      }),
    );

    await makeConnector({ resources: ['anthropic_cost_usd'] }).sync(
      { mode: 'full' },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );

    const headers = new Headers(lastInit?.headers as HeadersInit);
    expect(headers.get('x-api-key')).toBe('sk-ant-admin-test');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
  });

  it('passes workspaceIds as repeated workspace_ids query params', async () => {
    const seenUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        seenUrls.push(url);
        return Promise.resolve(
          mockJsonResponse({ data: [], has_more: false, next_page: null }),
        );
      }),
    );

    await makeConnector({
      workspaceIds: ['wrkspc_A', 'wrkspc_B'],
      resources: ['anthropic_input_tokens'],
    }).sync(
      { mode: 'full' },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );

    expect(seenUrls[0]).toContain('workspace_ids=wrkspc_A');
    expect(seenUrls[0]).toContain('workspace_ids=wrkspc_B');
  });

  it('skips the cost phase when only usage resources are requested', async () => {
    const seenUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        seenUrls.push(url);
        return Promise.resolve(
          mockJsonResponse({ data: [], has_more: false, next_page: null }),
        );
      }),
    );

    await makeConnector({ resources: ['anthropic_input_tokens'] }).sync(
      { mode: 'full' },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );

    expect(seenUrls.some((u) => u.includes('/usage_report/messages'))).toBe(
      true,
    );
    expect(seenUrls.some((u) => u.includes('/cost_report'))).toBe(false);
  });

  it('does not wipe older history when an incremental sync returns no rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            mockJsonResponse({ data: [], has_more: false, next_page: null }),
          ),
        ),
    );

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    const oldTs = Date.now() - 60 * 86_400_000;
    await handle.metrics(
      [
        {
          name: 'anthropic_cost_usd',
          ts: oldTs,
          value: 42,
          attributes: { workspace_id: null },
        },
      ],
      { names: ['anthropic_cost_usd'] },
    );

    await makeConnector({ resources: ['anthropic_cost_usd'] }).sync(
      { mode: 'latest' },
      handle,
    );

    const survivors = await handle.queryMetrics({ name: 'anthropic_cost_usd' });
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.ts).toBe(oldTs);
    expect(survivors[0]!.value).toBe(42);
  });
});

describe('buildUsageSamples', () => {
  it('emits one sample per metric per result row', () => {
    const out = buildUsageSamples([
      {
        starting_at: '2026-02-10T00:00:00Z',
        ending_at: '2026-02-11T00:00:00Z',
        results: [
          {
            api_key_id: 'apikey_1',
            cache_creation: {
              ephemeral_1h_input_tokens: 100,
              ephemeral_5m_input_tokens: 50,
            },
            cache_read_input_tokens: 200,
            context_window: '0-200k',
            inference_geo: 'global',
            model: 'claude-opus-4-6',
            output_tokens: 500,
            server_tool_use: { web_search_requests: 4 },
            service_account_id: null,
            account_id: null,
            service_tier: 'standard',
            uncached_input_tokens: 1500,
            workspace_id: 'wrkspc_A',
          },
        ],
      },
    ]);

    expect(out.inputTokens).toHaveLength(1);
    expect(out.inputTokens[0]!.value).toBe(1500);
    expect(out.outputTokens[0]!.value).toBe(500);
    expect(out.cacheReadTokens[0]!.value).toBe(200);
    expect(out.cacheCreationTokens[0]!.value).toBe(150);
    expect(
      out.cacheCreationTokens[0]!.attributes!['ephemeral_1h_input_tokens'],
    ).toBe(100);
    expect(out.webSearchRequests[0]!.value).toBe(4);
    expect(out.inputTokens[0]!.attributes!['model']).toBe('claude-opus-4-6');
    expect(out.inputTokens[0]!.ts).toBe(Date.UTC(2026, 1, 10, 0, 0, 0));
  });

  it('treats missing cache_creation and server_tool_use as zeros', () => {
    const out = buildUsageSamples([
      {
        starting_at: '2026-02-10T00:00:00Z',
        ending_at: '2026-02-11T00:00:00Z',
        results: [
          {
            api_key_id: null,
            cache_read_input_tokens: 0,
            model: 'claude-haiku-4-5',
            output_tokens: 10,
            service_tier: 'standard',
            uncached_input_tokens: 20,
            workspace_id: null,
          },
        ],
      },
    ]);
    expect(out.cacheCreationTokens[0]!.value).toBe(0);
    expect(out.webSearchRequests[0]!.value).toBe(0);
  });

  it('treats a partial cache_creation as zero for the missing ephemeral field', () => {
    const out = buildUsageSamples([
      {
        starting_at: '2026-02-10T00:00:00Z',
        ending_at: '2026-02-11T00:00:00Z',
        results: [
          {
            api_key_id: null,
            cache_creation: { ephemeral_1h_input_tokens: 100 },
            cache_read_input_tokens: 0,
            model: 'claude-haiku-4-5',
            output_tokens: 10,
            server_tool_use: {},
            service_tier: 'standard',
            uncached_input_tokens: 20,
            workspace_id: null,
          },
        ],
      },
    ]);
    expect(out.cacheCreationTokens[0]!.value).toBe(100);
    expect(
      out.cacheCreationTokens[0]!.attributes!['ephemeral_5m_input_tokens'],
    ).toBe(0);
    expect(out.webSearchRequests[0]!.value).toBe(0);
  });

  it('returns empty arrays for empty input', () => {
    expect(buildUsageSamples([])).toEqual({
      inputTokens: [],
      outputTokens: [],
      cacheReadTokens: [],
      cacheCreationTokens: [],
      webSearchRequests: [],
    });
  });
});

describe('buildCostSamples', () => {
  it('converts the amount string from cents to dollars and mirrors currency in attributes', () => {
    const out = buildCostSamples([
      {
        starting_at: '2026-02-10T00:00:00Z',
        ending_at: '2026-02-11T00:00:00Z',
        results: [
          {
            amount: '42500',
            context_window: '0-200k',
            cost_type: 'tokens',
            currency: 'USD',
            description: 'Claude Opus 4 - Input',
            inference_geo: 'global',
            model: 'claude-opus-4-6',
            service_tier: 'standard',
            token_type: 'uncached_input_tokens',
            workspace_id: 'wrkspc_A',
          },
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBeCloseTo(425, 6);
    expect(out[0]!.attributes!['currency']).toBe('USD');
    expect(out[0]!.attributes!['workspace_id']).toBe('wrkspc_A');
    expect(out[0]!.attributes).not.toHaveProperty('inference_geo');
  });

  it('falls back to 0 when the amount is unparseable', () => {
    const out = buildCostSamples([
      {
        starting_at: '2026-02-10T00:00:00Z',
        ending_at: '2026-02-11T00:00:00Z',
        results: [
          {
            amount: 'NaN',
            currency: 'USD',
          },
        ],
      },
    ]);
    expect(out[0]!.value).toBe(0);
  });
});

describe('getUsageWindow', () => {
  const now = Date.UTC(2026, 0, 31, 12, 0, 0);

  it('uses the full lookback for a full sync', () => {
    const w = getUsageWindow({ mode: 'full' }, 30, now);
    const startMs = Date.parse(w.startingAt);
    const endMs = Date.parse(w.endingAt);
    const days = (endMs - startMs) / (24 * 60 * 60 * 1000);
    expect(days).toBe(30);
  });

  it('uses a short refetch window in latest mode', () => {
    const w = getUsageWindow({ mode: 'latest' }, 30, now);
    const startMs = Date.parse(w.startingAt);
    const endMs = Date.parse(w.endingAt);
    const days = (endMs - startMs) / (24 * 60 * 60 * 1000);
    expect(days).toBe(2);
  });

  it('caps the window to lookbackDays even with an old `since`', () => {
    const since = new Date(now - 1000 * 24 * 60 * 60 * 1000).toISOString();
    const w = getUsageWindow({ mode: 'full', since }, 30, now);
    const startMs = Date.parse(w.startingAt);
    const endMs = Date.parse(w.endingAt);
    const days = (endMs - startMs) / (24 * 60 * 60 * 1000);
    expect(days).toBe(30);
  });

  it('emits RFC 3339 ISO timestamps the Admin API can parse', () => {
    const w = getUsageWindow({ mode: 'full' }, 30, now);
    expect(w.startingAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(w.endingAt).toMatch(/Z$/);
  });
});

describe('configFields', () => {
  const base = { adminApiKey: { $secret: 'ANTHROPIC_ADMIN_API_KEY' } };

  it('accepts a minimal valid config', () => {
    expect(() => configFields.parse(base)).not.toThrow();
  });

  it('rejects an empty admin api key secret name', () => {
    expect(() =>
      configFields.parse({ adminApiKey: { $secret: '' } }),
    ).toThrow();
  });

  it('rejects an empty workspaceIds array', () => {
    expect(() => configFields.parse({ ...base, workspaceIds: [] })).toThrow();
  });

  it('rejects a lookbackDays above the maximum', () => {
    expect(() => configFields.parse({ ...base, lookbackDays: 999 })).toThrow();
  });

  it('rejects an unknown resource name', () => {
    expect(() =>
      configFields.parse({ ...base, resources: ['nonexistent'] }),
    ).toThrow();
  });
});
