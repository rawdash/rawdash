import {
  entityStoreFor,
  metricStoreFor,
  mockJsonResponse,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LangSmithConnector, configFields } from './langsmith';

const CONNECTOR_ID = 'langsmith';

function makeConnector(
  overrides: Partial<{
    endpoint: string;
    lookbackDays: number;
    resources: readonly ('runs' | 'runs_per_day' | 'feedback')[];
  }> = {},
): LangSmithConnector {
  return new LangSmithConnector(
    { endpoint: 'https://api.smith.langchain.com', ...overrides },
    { apiKey: 'lsv2_test' },
  );
}

describe('LangSmith configFields', () => {
  it('parses a valid config with required fields only', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'LANGSMITH_API_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('defaults endpoint to https://api.smith.langchain.com', () => {
    const result = configFields.parse({
      apiKey: { $secret: 'LANGSMITH_API_KEY' },
    });
    expect(result.endpoint).toBe('https://api.smith.langchain.com');
  });

  it('rejects apiKey passed as a plain string', () => {
    const result = configFields.safeParse({
      apiKey: 'plain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects endpoint with a trailing slash', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'LANGSMITH_API_KEY' },
      endpoint: 'https://api.smith.langchain.com/',
    });
    expect(result.success).toBe(false);
  });

  it('rejects endpoint without protocol', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'LANGSMITH_API_KEY' },
      endpoint: 'api.smith.langchain.com',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a custom EU endpoint', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'LANGSMITH_API_KEY' },
      endpoint: 'https://eu.api.smith.langchain.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty resources array', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'LANGSMITH_API_KEY' },
      resources: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown resource names', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'LANGSMITH_API_KEY' },
      resources: ['runs', 'not_a_resource'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects lookbackDays above 365', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'LANGSMITH_API_KEY' },
      lookbackDays: 400,
    });
    expect(result.success).toBe(false);
  });
});

describe('LangSmithConnector sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes a run entity and a runs_per_day metric sample per run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/runs/query')) {
          return Promise.resolve(
            mockJsonResponse({
              runs: [
                {
                  id: 'run-1',
                  name: 'chain.invoke',
                  run_type: 'chain',
                  status: 'success',
                  session_id: 'sess-1',
                  start_time: '2026-06-01T00:00:00Z',
                  end_time: '2026-06-01T00:00:01.500Z',
                  total_tokens: 200,
                  prompt_tokens: 150,
                  completion_tokens: 50,
                  total_cost: '0.004',
                },
              ],
              cursors: { next: null },
            }),
          );
        }
        if (url.includes('/sessions')) {
          return Promise.resolve(
            mockJsonResponse([{ id: 'sess-1', name: 'default' }]),
          );
        }
        return Promise.resolve(mockJsonResponse([]));
      }),
    );
    const storage = new InMemoryStorage();
    await makeConnector({ resources: ['runs', 'runs_per_day'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    const entities = entityStoreFor(storage, CONNECTOR_ID).get('langsmith_run');
    expect(entities?.size).toBe(1);
    const entity = entities?.get('run-1') as unknown as {
      attributes: Record<string, unknown>;
    };
    expect(entity.attributes['sessionName']).toBe('default');
    expect(entity.attributes['totalCost']).toBeCloseTo(0.004);
    const samples = metricStoreFor(storage, CONNECTOR_ID).filter(
      (m) => (m as { name: string }).name === 'langsmith_runs_per_day',
    );
    expect(samples).toHaveLength(1);
    const sample = samples[0] as unknown as {
      ts: number;
      value: number;
      attributes: Record<string, unknown>;
    };
    expect(sample.value).toBe(1);
    expect(sample.ts).toBe(Date.parse('2026-06-01T00:00:00Z'));
    expect(sample.attributes['totalTokens']).toBe(200);
    expect(sample.attributes['costUsd']).toBeCloseTo(0.004);
    expect(sample.attributes['latencyMs']).toBe(1500);
    expect(sample.attributes['sessionName']).toBe('default');
  });

  it('skips runs phase entirely when only feedback is selected', async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/feedback')) {
        return Promise.resolve(
          mockJsonResponse([
            {
              id: 'fb-1',
              run_id: 'run-1',
              session_id: 'sess-1',
              key: 'quality',
              score: 0.8,
              created_at: '2026-06-01T00:00:02Z',
            },
          ]),
        );
      }
      return Promise.resolve(mockJsonResponse({ runs: [] }));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const storage = new InMemoryStorage();
    await makeConnector({ resources: ['feedback'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    const urls = fetchSpy.mock.calls.map((call) =>
      String((call as unknown as [string])[0]),
    );
    expect(urls.some((u) => u.includes('/runs/query'))).toBe(false);
    expect(urls.some((u) => u.includes('/feedback'))).toBe(true);
    const fbSamples = metricStoreFor(storage, CONNECTOR_ID).filter(
      (m) => (m as { name: string }).name === 'langsmith_feedback',
    );
    expect(fbSamples).toHaveLength(1);
  });

  it('marks non-numeric feedback as zero score but counts the row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/feedback')) {
          return Promise.resolve(
            mockJsonResponse([
              {
                id: 'fb-string',
                run_id: 'run-1',
                key: 'quality',
                comment: 'looks good',
                created_at: '2026-06-01T00:00:02Z',
              },
            ]),
          );
        }
        return Promise.resolve(mockJsonResponse({ runs: [] }));
      }),
    );
    const storage = new InMemoryStorage();
    await makeConnector({ resources: ['feedback'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    const samples = metricStoreFor(storage, CONNECTOR_ID).filter(
      (m) => (m as { name: string }).name === 'langsmith_feedback',
    );
    expect(samples).toHaveLength(1);
    const sample = samples[0] as unknown as {
      value: number;
      attributes: Record<string, unknown>;
    };
    expect(sample.value).toBe(0);
    expect(sample.attributes['hasNumericScore']).toBe(0);
    expect(sample.attributes['count']).toBe(1);
  });

  it('sends x-api-key header on each request', async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string, init: RequestInit) => {
        if (url.includes('/runs/query')) {
          const headers = new Headers(init.headers as HeadersInit);
          expect(headers.get('x-api-key')).toBe('lsv2_test');
          return Promise.resolve(
            mockJsonResponse({ runs: [], cursors: { next: null } }),
          );
        }
        if (url.includes('/feedback')) {
          const headers = new Headers(init.headers as HeadersInit);
          expect(headers.get('x-api-key')).toBe('lsv2_test');
          return Promise.resolve(mockJsonResponse([]));
        }
        return Promise.resolve(mockJsonResponse({}));
      });
    vi.stubGlobal('fetch', fetchSpy);
    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('paginates runs by passing the response next cursor back in the request body', async () => {
    const runBodies: Record<string, unknown>[] = [];
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string, init: RequestInit) => {
        if (url.includes('/runs/query')) {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          runBodies.push(body);
          if (runBodies.length === 1) {
            const runs = Array.from({ length: 100 }, (_, i) => ({
              id: `run-${i}`,
              name: 'r',
              run_type: 'llm',
              status: 'success',
              session_id: 'sess-1',
              start_time: '2026-06-01T00:00:00Z',
              end_time: '2026-06-01T00:00:01Z',
              total_tokens: 1,
              total_cost: '0.001',
            }));
            return Promise.resolve(
              mockJsonResponse({ runs, cursors: { next: 'tok-page-2' } }),
            );
          }
          return Promise.resolve(
            mockJsonResponse({
              runs: [
                {
                  id: 'run-tail',
                  name: 'r',
                  run_type: 'llm',
                  status: 'success',
                  start_time: '2026-06-01T00:00:00Z',
                  end_time: '2026-06-01T00:00:01Z',
                },
              ],
              cursors: { next: null },
            }),
          );
        }
        return Promise.resolve(mockJsonResponse([]));
      });
    vi.stubGlobal('fetch', fetchSpy);
    const storage = new InMemoryStorage();
    await makeConnector({ resources: ['runs'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(runBodies).toHaveLength(2);
    expect(runBodies[0]).not.toHaveProperty('cursor');
    expect(runBodies[0]).not.toHaveProperty('offset');
    expect(runBodies[0]?.['select']).toContain('total_cost');
    expect(runBodies[1]?.['cursor']).toBe('tok-page-2');
    const entities = entityStoreFor(storage, CONNECTOR_ID).get('langsmith_run');
    expect(entities?.size).toBe(101);
  });

  it('bounds incremental runs queries server-side via start_time from options.since', async () => {
    const runBodies: Record<string, unknown>[] = [];
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string, init: RequestInit) => {
        if (url.includes('/runs/query')) {
          runBodies.push(
            JSON.parse(String(init.body)) as Record<string, unknown>,
          );
          return Promise.resolve(
            mockJsonResponse({ runs: [], cursors: { next: null } }),
          );
        }
        return Promise.resolve(mockJsonResponse([]));
      });
    vi.stubGlobal('fetch', fetchSpy);
    const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const storage = new InMemoryStorage();
    await makeConnector({ resources: ['runs'] }).sync(
      { mode: 'latest', since },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(runBodies).toHaveLength(1);
    expect(runBodies[0]?.['start_time']).toBe(since);
  });

  it('stores boolean feedback scores as 1/0 and counts them as scored', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/feedback')) {
          return Promise.resolve(
            mockJsonResponse([
              {
                id: 'fb-bool',
                run_id: 'run-1',
                key: 'thumbs',
                score: true,
                created_at: '2026-06-01T00:00:02Z',
              },
            ]),
          );
        }
        return Promise.resolve(mockJsonResponse({ runs: [] }));
      }),
    );
    const storage = new InMemoryStorage();
    await makeConnector({ resources: ['feedback'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    const samples = metricStoreFor(storage, CONNECTOR_ID).filter(
      (m) => (m as { name: string }).name === 'langsmith_feedback',
    );
    expect(samples).toHaveLength(1);
    const sample = samples[0] as unknown as {
      value: number;
      attributes: Record<string, unknown>;
    };
    expect(sample.value).toBe(1);
    expect(sample.attributes['hasNumericScore']).toBe(1);
  });

  it('windows feedback requests with min_created_at', async () => {
    const feedbackUrls: string[] = [];
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/feedback')) {
        feedbackUrls.push(url);
        return Promise.resolve(mockJsonResponse([]));
      }
      return Promise.resolve(mockJsonResponse({ runs: [] }));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const storage = new InMemoryStorage();
    await makeConnector({ resources: ['feedback'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(feedbackUrls).toHaveLength(1);
    const parsed = new URL(feedbackUrls[0] as string);
    expect(parsed.searchParams.get('min_created_at')).toBeTruthy();
    expect(parsed.searchParams.get('start_time')).toBeNull();
  });
});
