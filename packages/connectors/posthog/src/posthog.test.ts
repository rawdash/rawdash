import {
  entityStoreFor,
  installFetchMock,
  metricStoreFor,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PostHogConnector } from './posthog';

const CONNECTOR_ID = 'posthog';
const API_KEY = 'POSTHOG_API_KEY' as unknown as { $secret: string };
const HOST = 'https://us.posthog.com';

interface StoredMetric {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, unknown>;
}

function postHogMetrics(
  storage: InMemoryStorage,
  name: string,
): StoredMetric[] {
  return metricStoreFor<StoredMetric>(storage, CONNECTOR_ID).filter(
    (m) => m.name === name,
  );
}

function connector(
  settings: Partial<ConstructorParameters<typeof PostHogConnector>[0]> = {},
): PostHogConnector {
  return new PostHogConnector(
    { projectId: '42', host: HOST, ...settings },
    { apiKey: API_KEY },
  );
}

describe('PostHogConnector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps feature flags to entities', async () => {
    installFetchMock(() => ({
      count: 2,
      next: null,
      results: [
        {
          id: 7,
          key: 'new-checkout',
          name: 'New checkout',
          active: true,
          rollout_percentage: 40,
          created_at: '2026-05-01T00:00:00Z',
          filters: { groups: [{ rollout_percentage: 40 }] },
        },
        {
          id: 8,
          key: 'beta-dashboard',
          name: null,
          active: false,
          rollout_percentage: null,
          created_at: null,
        },
      ],
    }));

    const storage = new InMemoryStorage();
    const result = await connector({ resources: ['feature_flags'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(result.done).toBe(true);
    const flags = entityStoreFor(storage, CONNECTOR_ID).get(
      'posthog_feature_flag',
    );
    expect(flags?.size).toBe(2);
    const first = flags?.get('7') as
      | { attributes: Record<string, unknown>; updated_at: number }
      | undefined;
    expect(first?.attributes).toMatchObject({
      key: 'new-checkout',
      name: 'New checkout',
      active: true,
      rolloutPercentage: 40,
    });
    expect(first?.attributes['filters']).toBe(
      JSON.stringify({ groups: [{ rollout_percentage: 40 }] }),
    );
    expect(first?.updated_at).toBe(Date.parse('2026-05-01T00:00:00Z'));

    const second = flags?.get('8') as
      | { attributes: Record<string, unknown> }
      | undefined;
    expect(second?.attributes).toMatchObject({
      rolloutPercentage: null,
      filters: null,
    });
  });

  it('rolls up events per day from HogQL rows', async () => {
    installFetchMock(() => ({
      results: [
        ['2026-05-20', 'pageview', 120, 80],
        ['2026-05-21', 'pageview', 90, 60],
      ],
    }));

    const storage = new InMemoryStorage();
    await connector({
      resources: ['events_per_day'],
      events: ['pageview'],
    }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    const metrics = postHogMetrics(storage, 'posthog_events_per_day');
    expect(metrics).toHaveLength(2);
    expect(metrics[0]).toMatchObject({
      value: 120,
      ts: Date.parse('2026-05-20T00:00:00.000Z'),
      attributes: { event: 'pageview', count: 120, distinctUsers: 80 },
    });
  });

  it('scopes events_per_day to the configured events in the query', async () => {
    const spy = installFetchMock(() => ({ results: [] }));
    const storage = new InMemoryStorage();
    await connector({
      resources: ['events_per_day'],
      events: ['signed_up', "weird'name"],
    }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    const body = JSON.parse(String(spy.mock.calls[0]?.[1]?.body ?? '{}')) as {
      query: { query: string };
    };
    const sql = body.query.query;
    expect(sql).toContain("'signed_up'");
    // Single quotes in event names are escaped for the HogQL string literal.
    expect(sql).toContain("'weird\\'name'");
  });

  it('maps dau/wau/mau trend series to the active_users metric', async () => {
    installFetchMock(() => ({
      results: [
        { data: [10, 12], days: ['2026-05-20', '2026-05-21'], label: 'DAU' },
        { data: [40, 44], days: ['2026-05-20', '2026-05-21'], label: 'WAU' },
        { data: [90, 95], days: ['2026-05-20', '2026-05-21'], label: 'MAU' },
      ],
    }));

    const storage = new InMemoryStorage();
    await connector({ resources: ['active_users'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const metrics = postHogMetrics(storage, 'posthog_active_users');
    expect(metrics).toHaveLength(6);
    const windows = new Set(
      metrics.map((m) => (m.attributes as { window: string }).window),
    );
    expect(windows).toEqual(new Set(['dau', 'wau', 'mau']));
    const mau = metrics.find(
      (m) =>
        (m.attributes as { window: string }).window === 'mau' &&
        m.ts === Date.parse('2026-05-21T00:00:00.000Z'),
    );
    expect(mau?.value).toBe(95);
  });

  it('computes funnel conversion rates relative to the first step', async () => {
    installFetchMock(() => ({
      results: [
        { count: 100, name: 'Viewed', order: 0 },
        { count: 60, name: 'Added to cart', order: 1 },
        { count: 24, name: 'Purchased', order: 2 },
      ],
    }));

    const storage = new InMemoryStorage();
    await connector({
      resources: ['funnels'],
      funnels: [{ name: 'Checkout', steps: ['viewed', 'added', 'purchased'] }],
    }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    const metrics = postHogMetrics(storage, 'posthog_funnel');
    expect(metrics).toHaveLength(3);
    const purchased = metrics.find(
      (m) => (m.attributes as { step: number }).step === 2,
    );
    expect(purchased).toMatchObject({
      value: 24,
      attributes: {
        funnel: 'Checkout',
        stepName: 'Purchased',
        users: 24,
        conversionRate: 0.24,
      },
    });
  });

  it('passes the incremental since bound into the HogQL window', async () => {
    const spy = installFetchMock(() => ({ results: [] }));
    const storage = new InMemoryStorage();
    await connector({ resources: ['events_per_day'] }).sync(
      { mode: 'latest', since: '2026-05-15T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const body = String(spy.mock.calls[0]?.[1]?.body ?? '');
    expect(body).toContain('2026-05-15');
  });

  it('clears the metric scope on a full resync (idempotent rewrite)', async () => {
    installFetchMock(() => ({
      results: [['2026-05-20', 'pageview', 5, 3]],
    }));
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);

    await connector({ resources: ['events_per_day'] }).sync(
      { mode: 'full' },
      handle,
    );
    await connector({ resources: ['events_per_day'] }).sync(
      { mode: 'full' },
      handle,
    );

    const metrics = postHogMetrics(storage, 'posthog_events_per_day');
    expect(metrics).toHaveLength(1);
  });
});
