import {
  installFetchMockAdvanced,
  metricStoreFor,
  mockJsonResponse,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OpenAIConnector,
  type OpenAIResource,
  buildCompletionsSamples,
  buildCostSamples,
  buildEmbeddingsSamples,
  configFields,
  getUsageWindow,
} from './openai';

const CONNECTOR_ID = 'openai';

function makeConnector(
  overrides: {
    organizationId?: string;
    projectIds?: readonly string[];
    lookbackDays?: number;
    resources?: readonly OpenAIResource[];
  } = {},
): OpenAIConnector {
  return new OpenAIConnector(
    {
      organizationId: overrides.organizationId,
      projectIds: overrides.projectIds,
      lookbackDays: overrides.lookbackDays ?? 7,
      resources: overrides.resources,
    },
    { adminApiKey: 'sk-admin-test' as unknown as { $secret: string } },
  );
}

describe('OpenAIConnector sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches each usage endpoint and writes one metric per resource', async () => {
    const calls: string[] = [];
    installFetchMockAdvanced((url) => {
      calls.push(url);
      if (url.includes('/usage/completions')) {
        return {
          body: {
            object: 'page',
            data: [
              {
                object: 'bucket',
                start_time: 1700000000,
                end_time: 1700086400,
                results: [
                  {
                    object: 'organization.usage.completions.result',
                    input_tokens: 1000,
                    input_cached_tokens: 50,
                    output_tokens: 500,
                    input_audio_tokens: 0,
                    output_audio_tokens: 0,
                    num_model_requests: 4,
                    project_id: 'proj_A',
                    user_id: null,
                    api_key_id: 'key_1',
                    model: 'gpt-4o',
                    batch: false,
                  },
                ],
              },
            ],
            has_more: false,
            next_page: null,
          },
        };
      }
      if (url.includes('/usage/embeddings')) {
        return {
          body: {
            object: 'page',
            data: [
              {
                object: 'bucket',
                start_time: 1700000000,
                end_time: 1700086400,
                results: [
                  {
                    object: 'organization.usage.embeddings.result',
                    input_tokens: 800,
                    num_model_requests: 6,
                    project_id: 'proj_A',
                    user_id: null,
                    api_key_id: null,
                    model: 'text-embedding-3-small',
                  },
                ],
              },
            ],
            has_more: false,
            next_page: null,
          },
        };
      }
      if (url.includes('/usage/images')) {
        return {
          body: {
            object: 'page',
            data: [
              {
                object: 'bucket',
                start_time: 1700000000,
                end_time: 1700086400,
                results: [
                  {
                    object: 'organization.usage.images.result',
                    images: 3,
                    num_model_requests: 2,
                    source: 'image-generation',
                    size: '1024x1024',
                    project_id: null,
                    user_id: null,
                    api_key_id: null,
                    model: 'dall-e-3',
                  },
                ],
              },
            ],
            has_more: false,
            next_page: null,
          },
        };
      }
      if (url.includes('/usage/audio_speeches')) {
        return {
          body: {
            object: 'page',
            data: [
              {
                object: 'bucket',
                start_time: 1700000000,
                end_time: 1700086400,
                results: [
                  {
                    object: 'organization.usage.audio_speeches.result',
                    characters: 12000,
                    num_model_requests: 4,
                    project_id: null,
                    user_id: null,
                    api_key_id: null,
                    model: 'tts-1',
                  },
                ],
              },
            ],
            has_more: false,
            next_page: null,
          },
        };
      }
      if (url.includes('/usage/audio_transcriptions')) {
        return {
          body: {
            object: 'page',
            data: [
              {
                object: 'bucket',
                start_time: 1700000000,
                end_time: 1700086400,
                results: [
                  {
                    object: 'organization.usage.audio_transcriptions.result',
                    seconds: 360,
                    num_model_requests: 2,
                    project_id: null,
                    user_id: null,
                    api_key_id: null,
                    model: 'whisper-1',
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
          object: 'page',
          data: [
            {
              object: 'bucket',
              start_time: 1700000000,
              end_time: 1700086400,
              results: [
                {
                  object: 'organization.costs.result',
                  amount: { value: 12.34, currency: 'usd' },
                  line_item: 'Nov 2026 - Chat Completions',
                  project_id: 'proj_A',
                  organization_id: 'org_X',
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
    expect(byName.get('openai_completions_input_tokens')).toBe(1);
    expect(byName.get('openai_completions_output_tokens')).toBe(1);
    expect(byName.get('openai_completions_requests')).toBe(1);
    expect(byName.get('openai_embeddings_input_tokens')).toBe(1);
    expect(byName.get('openai_embeddings_requests')).toBe(1);
    expect(byName.get('openai_images_count')).toBe(1);
    expect(byName.get('openai_images_requests')).toBe(1);
    expect(byName.get('openai_audio_speeches_characters')).toBe(1);
    expect(byName.get('openai_audio_speeches_requests')).toBe(1);
    expect(byName.get('openai_audio_transcriptions_seconds')).toBe(1);
    expect(byName.get('openai_audio_transcriptions_requests')).toBe(1);
    expect(byName.get('openai_cost_usd')).toBe(1);

    const cost = metrics.find((m) => m.name === 'openai_cost_usd')!;
    expect(cost.value).toBe(12.34);
    expect(cost.attributes['line_item']).toBe('Nov 2026 - Chat Completions');
    expect(cost.attributes['currency']).toBe('usd');

    expect(calls.some((u) => u.includes('start_time='))).toBe(true);
    expect(calls.some((u) => u.includes('bucket_width=1d'))).toBe(true);
  });

  it('paginates via has_more / next_page on usage_completions', async () => {
    const responses = [
      {
        object: 'page',
        data: [
          {
            object: 'bucket',
            start_time: 1700000000,
            end_time: 1700086400,
            results: [
              {
                object: 'organization.usage.completions.result',
                input_tokens: 100,
                output_tokens: 50,
                num_model_requests: 1,
                project_id: 'proj_A',
                model: 'gpt-4o',
              },
            ],
          },
        ],
        has_more: true,
        next_page: 'cursor_page_2',
      },
      {
        object: 'page',
        data: [
          {
            object: 'bucket',
            start_time: 1700086400,
            end_time: 1700172800,
            results: [
              {
                object: 'organization.usage.completions.result',
                input_tokens: 200,
                output_tokens: 90,
                num_model_requests: 2,
                project_id: 'proj_A',
                model: 'gpt-4o',
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
        const body =
          calls.length === 1 || !url.includes('/usage/completions')
            ? url.includes('/usage/completions')
              ? responses[0]
              : { object: 'page', data: [], has_more: false, next_page: null }
            : responses[1];
        return Promise.resolve(mockJsonResponse(body));
      }),
    );

    const storage = new InMemoryStorage();
    await makeConnector({
      resources: [
        'openai_completions_input_tokens',
        'openai_completions_output_tokens',
        'openai_completions_requests',
      ],
    }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    const completionsCalls = calls.filter((u) =>
      u.includes('/usage/completions'),
    );
    expect(completionsCalls).toHaveLength(2);
    expect(completionsCalls[1]).toContain('page=cursor_page_2');

    const metrics = metricStoreFor<{ name: string; value: number }>(
      storage,
      CONNECTOR_ID,
    );
    const inputTokens = metrics
      .filter((m) => m.name === 'openai_completions_input_tokens')
      .map((m) => m.value);
    expect(inputTokens).toEqual([100, 200]);
  });

  it('sends the OpenAI-Organization header when organizationId is set', async () => {
    let lastInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        lastInit = init;
        return Promise.resolve(
          mockJsonResponse({
            object: 'page',
            data: [],
            has_more: false,
            next_page: null,
          }),
        );
      }),
    );

    await makeConnector({
      organizationId: 'org_abc',
      resources: ['openai_cost_usd'],
    }).sync(
      { mode: 'full' },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );

    const headers = new Headers(lastInit?.headers as HeadersInit);
    expect(headers.get('OpenAI-Organization')).toBe('org_abc');
  });

  it('passes projectIds as repeated project_ids query params', async () => {
    const seenUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        seenUrls.push(url);
        return Promise.resolve(
          mockJsonResponse({
            object: 'page',
            data: [],
            has_more: false,
            next_page: null,
          }),
        );
      }),
    );

    await makeConnector({
      projectIds: ['proj_A', 'proj_B'],
      resources: ['openai_cost_usd'],
    }).sync(
      { mode: 'full' },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );

    expect(seenUrls[0]).toContain('project_ids=proj_A');
    expect(seenUrls[0]).toContain('project_ids=proj_B');
  });
});

describe('buildCompletionsSamples', () => {
  it('emits one input_tokens / output_tokens / requests sample per result row', () => {
    const out = buildCompletionsSamples([
      {
        start_time: 1700000000,
        end_time: 1700086400,
        results: [
          {
            object: 'organization.usage.completions.result',
            input_tokens: 100,
            input_cached_tokens: 10,
            output_tokens: 50,
            input_audio_tokens: 0,
            output_audio_tokens: 5,
            num_model_requests: 2,
            project_id: 'proj_A',
            user_id: null,
            api_key_id: 'key_1',
            model: 'gpt-4o',
            batch: false,
          },
        ],
      },
    ]);

    expect(out.inputTokens).toHaveLength(1);
    expect(out.inputTokens[0]!.value).toBe(100);
    expect(out.inputTokens[0]!.attributes!['input_cached_tokens']).toBe(10);
    expect(out.outputTokens[0]!.value).toBe(50);
    expect(out.outputTokens[0]!.attributes!['output_audio_tokens']).toBe(5);
    expect(out.requests[0]!.value).toBe(2);
    expect(out.requests[0]!.attributes!['model']).toBe('gpt-4o');
    expect(out.inputTokens[0]!.ts).toBe(1700000000 * 1000);
  });

  it('returns empty arrays for empty input', () => {
    expect(buildCompletionsSamples([])).toEqual({
      inputTokens: [],
      outputTokens: [],
      requests: [],
    });
  });
});

describe('buildEmbeddingsSamples', () => {
  it('mirrors input_tokens and num_model_requests', () => {
    const out = buildEmbeddingsSamples([
      {
        start_time: 1700000000,
        end_time: 1700086400,
        results: [
          {
            object: 'organization.usage.embeddings.result',
            input_tokens: 999,
            num_model_requests: 7,
            project_id: 'proj_X',
            user_id: null,
            api_key_id: null,
            model: 'text-embedding-3-small',
          },
        ],
      },
    ]);
    expect(out.inputTokens[0]!.value).toBe(999);
    expect(out.requests[0]!.value).toBe(7);
    expect(out.inputTokens[0]!.attributes!['project_id']).toBe('proj_X');
  });
});

describe('buildCostSamples', () => {
  it('uses amount.value as the sample and mirrors currency in attributes', () => {
    const out = buildCostSamples([
      {
        start_time: 1700000000,
        end_time: 1700086400,
        results: [
          {
            object: 'organization.costs.result',
            amount: { value: 42.5, currency: 'usd' },
            line_item: 'Foo',
            project_id: 'proj_A',
            organization_id: 'org_X',
          },
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBe(42.5);
    expect(out[0]!.attributes!['currency']).toBe('usd');
    expect(out[0]!.attributes!['line_item']).toBe('Foo');
  });
});

describe('getUsageWindow', () => {
  const now = Date.UTC(2026, 0, 31, 12, 0, 0);

  it('uses the full lookback for a full sync', () => {
    const w = getUsageWindow({ mode: 'full' }, 30, now);
    const days = (w.endTimeSeconds - w.startTimeSeconds) / (24 * 60 * 60);
    expect(days).toBe(30);
  });

  it('uses a short refetch window in latest mode', () => {
    const w = getUsageWindow({ mode: 'latest' }, 30, now);
    const days = (w.endTimeSeconds - w.startTimeSeconds) / (24 * 60 * 60);
    expect(days).toBe(2);
  });

  it('caps the window to lookbackDays even with an old `since`', () => {
    const since = new Date(now - 1000 * 24 * 60 * 60 * 1000).toISOString();
    const w = getUsageWindow({ mode: 'full', since }, 30, now);
    const days = (w.endTimeSeconds - w.startTimeSeconds) / (24 * 60 * 60);
    expect(days).toBe(30);
  });
});

describe('configFields', () => {
  const base = { adminApiKey: { $secret: 'OPENAI_ADMIN_API_KEY' } };

  it('accepts a minimal valid config', () => {
    expect(() => configFields.parse(base)).not.toThrow();
  });

  it('rejects an empty admin api key secret name', () => {
    expect(() =>
      configFields.parse({ adminApiKey: { $secret: '' } }),
    ).toThrow();
  });

  it('rejects an empty projectIds array', () => {
    expect(() => configFields.parse({ ...base, projectIds: [] })).toThrow();
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
