import {
  entityStoreFor,
  installFetchMock,
  metricStoreFor,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LangfuseConnector } from './langfuse';

const CONNECTOR_ID = 'langfuse';
const SECRET = 'LANGFUSE_SECRET_KEY' as unknown as { $secret: string };
const HOST = 'https://cloud.langfuse.com';

interface StoredMetric {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, unknown>;
}

function langfuseMetrics(
  storage: InMemoryStorage,
  name: string,
): StoredMetric[] {
  return metricStoreFor<StoredMetric>(storage, CONNECTOR_ID).filter(
    (m) => m.name === name,
  );
}

function connector(
  settings: Partial<ConstructorParameters<typeof LangfuseConnector>[0]> = {},
): LangfuseConnector {
  return new LangfuseConnector(
    { publicKey: 'pk-lf-test', host: HOST, ...settings },
    { secretKey: SECRET },
  );
}

describe('LangfuseConnector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('upserts traces as entities keyed by id', async () => {
    installFetchMock(() => ({
      data: [
        {
          id: 'trace-1',
          name: 'completion',
          projectId: 'proj_42',
          userId: 'user_a',
          sessionId: 'sess_z',
          release: 'r1',
          version: 'v1',
          totalCost: 0.0123,
          latency: 1450,
          createdAt: '2026-05-20T01:02:03Z',
          updatedAt: '2026-05-20T01:02:04Z',
        },
        {
          id: 'trace-2',
          name: null,
          projectId: 'proj_42',
          totalCost: null,
          latency: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      meta: { page: 1, limit: 50, totalItems: 2, totalPages: 1 },
    }));

    const storage = new InMemoryStorage();
    const result = await connector({ resources: ['traces'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(result.done).toBe(true);
    const traces = entityStoreFor(storage, CONNECTOR_ID).get('langfuse_trace');
    expect(traces?.size).toBe(2);
    const first = traces?.get('trace-1') as
      | { attributes: Record<string, unknown>; updated_at: number }
      | undefined;
    expect(first?.attributes).toMatchObject({
      name: 'completion',
      projectId: 'proj_42',
      userId: 'user_a',
      sessionId: 'sess_z',
      totalCost: 0.0123,
      latencyMs: 1450,
    });
    expect(first?.updated_at).toBe(Date.parse('2026-05-20T01:02:04Z'));

    const second = traces?.get('trace-2') as
      | { attributes: Record<string, unknown>; updated_at: number }
      | undefined;
    expect(second?.attributes).toMatchObject({
      totalCost: null,
      latencyMs: null,
      createdAt: null,
    });
    expect(second?.updated_at).toBe(0);
  });

  it('sends Basic auth using publicKey:secretKey', async () => {
    const spy = installFetchMock(() => ({
      data: [],
      meta: { page: 1, limit: 50, totalItems: 0, totalPages: 0 },
    }));
    const storage = new InMemoryStorage();
    await connector({ resources: ['traces'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const init = spy.mock.calls[0]?.[1] as { headers?: Record<string, string> };
    const headers = init?.headers ?? {};
    const auth = headers['authorization'] ?? headers['Authorization'] ?? '';
    expect(auth.startsWith('Basic ')).toBe(true);
    const decoded = decodeBase64(auth.slice('Basic '.length));
    expect(decoded).toBe('pk-lf-test:LANGFUSE_SECRET_KEY');
  });

  it('paginates traces until totalPages is reached', async () => {
    let calls = 0;
    installFetchMock(() => {
      calls += 1;
      return {
        data: [
          {
            id: `trace-${calls}`,
            createdAt: '2026-05-20T00:00:00Z',
            updatedAt: '2026-05-20T00:00:00Z',
          },
        ],
        meta: { page: calls, limit: 50, totalItems: 3, totalPages: 3 },
      };
    });

    const storage = new InMemoryStorage();
    await connector({ resources: ['traces'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(calls).toBe(3);
    const traces = entityStoreFor(storage, CONNECTOR_ID).get('langfuse_trace');
    expect(traces?.size).toBe(3);
  });

  it('short-circuits trace pagination once a page is entirely before `since`', async () => {
    let calls = 0;
    installFetchMock(() => {
      calls += 1;
      if (calls === 1) {
        return {
          data: [
            { id: 'fresh', createdAt: '2026-05-21T00:00:00Z' },
            { id: 'stale', createdAt: '2024-01-01T00:00:00Z' },
          ],
          meta: { page: 1, limit: 50, totalItems: 100, totalPages: 5 },
        };
      }
      return {
        data: [{ id: `older-${calls}`, createdAt: '2023-01-01T00:00:00Z' }],
        meta: { page: calls, limit: 50, totalItems: 100, totalPages: 5 },
      };
    });

    const storage = new InMemoryStorage();
    await connector({ resources: ['traces'] }).sync(
      { mode: 'latest', since: '2026-05-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    // Second page: every row before `since`, so pagination stops.
    expect(calls).toBe(2);
  });

  it('rolls up daily metrics by model with token + cost attributes', async () => {
    installFetchMock(() => ({
      data: [
        {
          date: '2026-05-20',
          countTraces: 5,
          countObservations: 10,
          totalCost: 0.5,
          usage: [
            {
              model: 'gpt-4o',
              inputUsage: 1000,
              outputUsage: 500,
              totalUsage: 1500,
              countObservations: 6,
              totalCost: 0.3,
            },
            {
              model: 'claude-3-haiku',
              inputUsage: 400,
              outputUsage: 200,
              totalUsage: 600,
              countObservations: 4,
              totalCost: 0.2,
            },
          ],
        },
      ],
      meta: { page: 1, limit: 50, totalItems: 1, totalPages: 1 },
    }));

    const storage = new InMemoryStorage();
    await connector({ resources: ['observations_per_day'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const metrics = langfuseMetrics(storage, 'langfuse_observations_per_day');
    expect(metrics).toHaveLength(2);
    const gpt = metrics.find(
      (m) => (m.attributes as { model: string }).model === 'gpt-4o',
    );
    expect(gpt).toMatchObject({
      ts: Date.parse('2026-05-20T00:00:00.000Z'),
      value: 6,
      attributes: {
        model: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: 0.3,
      },
    });
  });

  it('falls back to a single sample when daily usage is empty', async () => {
    installFetchMock(() => ({
      data: [
        {
          date: '2026-05-20',
          countObservations: 7,
          totalCost: 0.1,
          usage: [],
        },
      ],
      meta: { page: 1, limit: 50, totalItems: 1, totalPages: 1 },
    }));

    const storage = new InMemoryStorage();
    await connector({ resources: ['observations_per_day'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const metrics = langfuseMetrics(storage, 'langfuse_observations_per_day');
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      value: 7,
      attributes: {
        model: null,
        costUsd: 0.1,
      },
    });
  });

  it('rolls up scores by (day, name) with average and count', async () => {
    installFetchMock(() => ({
      data: [
        {
          id: 's1',
          name: 'helpfulness',
          value: 1.0,
          timestamp: '2026-05-20T01:00:00Z',
        },
        {
          id: 's2',
          name: 'helpfulness',
          value: 0.5,
          timestamp: '2026-05-20T05:00:00Z',
        },
        {
          id: 's3',
          name: 'tone',
          value: null,
          stringValue: 'great',
          timestamp: '2026-05-20T12:00:00Z',
        },
      ],
      meta: { page: 1, limit: 50, totalItems: 3, totalPages: 1 },
    }));

    const storage = new InMemoryStorage();
    await connector({ resources: ['scores'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const metrics = langfuseMetrics(storage, 'langfuse_scores');
    expect(metrics).toHaveLength(2);
    const helpfulness = metrics.find(
      (m) =>
        (m.attributes as { scoreName: string }).scoreName === 'helpfulness',
    );
    expect(helpfulness).toMatchObject({
      ts: Date.parse('2026-05-20T00:00:00.000Z'),
      value: 0.75,
      attributes: { scoreName: 'helpfulness', count: 2 },
    });
    const tone = metrics.find(
      (m) => (m.attributes as { scoreName: string }).scoreName === 'tone',
    );
    expect(tone).toMatchObject({
      value: 0,
      attributes: { scoreName: 'tone', count: 1 },
    });
  });

  it('aggregates scores across pages when the same (day, name) bucket spans two pages', async () => {
    let page = 0;
    installFetchMock(() => {
      page += 1;
      if (page === 1) {
        return {
          data: [
            {
              id: 's1',
              name: 'quality',
              value: 1.0,
              timestamp: '2026-05-20T01:00:00Z',
            },
            {
              id: 's2',
              name: 'quality',
              value: 0.5,
              timestamp: '2026-05-20T02:00:00Z',
            },
          ],
          meta: { page: 1, limit: 50, totalItems: 4, totalPages: 2 },
        };
      }
      return {
        data: [
          {
            id: 's3',
            name: 'quality',
            value: 0.0,
            timestamp: '2026-05-20T10:00:00Z',
          },
          {
            id: 's4',
            name: 'quality',
            value: 0.5,
            timestamp: '2026-05-20T11:00:00Z',
          },
        ],
        meta: { page: 2, limit: 50, totalItems: 4, totalPages: 2 },
      };
    });

    const storage = new InMemoryStorage();
    await connector({ resources: ['scores'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const metrics = langfuseMetrics(storage, 'langfuse_scores');
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      ts: Date.parse('2026-05-20T00:00:00.000Z'),
      attributes: {
        scoreName: 'quality',
        count: 4,
      },
    });
  });

  it('extends the fromTimestamp window when since predates the lookback', async () => {
    const spy = installFetchMock(() => ({
      data: [],
      meta: { page: 1, limit: 50, totalItems: 0, totalPages: 0 },
    }));
    const storage = new InMemoryStorage();
    await connector({ resources: ['traces'] }).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const url = String(spy.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('fromTimestamp=2024-01-01');
  });

  it('clears the metric scope on a full resync (idempotent rewrite)', async () => {
    installFetchMock(() => ({
      data: [
        {
          date: '2026-05-20',
          countObservations: 5,
          totalCost: 0,
          usage: [
            {
              model: 'm',
              countObservations: 5,
              inputUsage: 1,
              outputUsage: 1,
              totalUsage: 2,
              totalCost: 0,
            },
          ],
        },
      ],
      meta: { page: 1, limit: 50, totalItems: 1, totalPages: 1 },
    }));
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);

    await connector({ resources: ['observations_per_day'] }).sync(
      { mode: 'full' },
      handle,
    );
    await connector({ resources: ['observations_per_day'] }).sync(
      { mode: 'full' },
      handle,
    );

    const metrics = langfuseMetrics(storage, 'langfuse_observations_per_day');
    expect(metrics).toHaveLength(1);
  });
});

function decodeBase64(input: string): string {
  if (typeof atob === 'function') {
    return atob(input);
  }
  const bufferCtor = (
    globalThis as {
      Buffer?: { from: (s: string, e: string) => { toString: () => string } };
    }
  ).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(input, 'base64').toString();
  }
  throw new Error('No base64 decoder available in this runtime');
}
