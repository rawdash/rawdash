import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorMetricConformanceViolations,
  connectorResourceShapeViolations,
  eventStoreFor,
  installFetchMock,
  metricStoreFor,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { MailgunConnector } from './mailgun';

const CONNECTOR_ID = 'mailgun';
const KEY = 'MAILGUN_API_KEY' as unknown as { $secret: string };

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] => [
  ...connectorResourceShapeViolations(
    MailgunConnector.resources,
    storage,
    connectorId,
  ),
  ...connectorMetricConformanceViolations(
    MailgunConnector.resources,
    storage,
    connectorId,
  ),
];

type MetricsSample = z.infer<typeof MailgunConnector.schemas.email_stats>;
type LogsSample = z.infer<typeof MailgunConnector.schemas.events>;

function makeConnector(resources?: string[]) {
  return new MailgunConnector(
    {
      domain: 'mg.example.com',
      region: 'us',
      lookbackDays: 7,
      resources: resources as never,
    },
    { apiKey: KEY },
  );
}

function metricCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: MetricsSample,
): InvariantViolation[] {
  const samples = metricStoreFor(storage, connectorId).filter(
    (m) => m.name === 'mailgun_email_stats',
  );
  if (samples.length !== sample.items.length) {
    return [
      {
        invariant: 'one mailgun_email_stats sample per metrics item',
        location: 'email_stats phase',
        detail: `expected ${sample.items.length} metrics, got ${samples.length}`,
      },
    ];
  }
  return [];
}

function eventCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: LogsSample,
): InvariantViolation[] {
  const distinctIds = new Set(sample.items.map((item) => item.id)).size;
  const events = eventStoreFor<{ name: string }>(storage, connectorId).filter(
    (e) => e.name === 'mailgun_event',
  );
  if (events.length !== distinctIds) {
    return [
      {
        invariant: 'one mailgun_event per distinct log id',
        location: 'events phase',
        detail: `expected ${distinctIds} events, got ${events.length}`,
      },
    ];
  }
  return [];
}

describe('MailgunConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('email_stats: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<MetricsSample>({
      connectorClass: MailgunConnector,
      resource: 'email_stats',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [metricCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ items: sample.items }));
        await makeConnector(['email_stats']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('events: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<LogsSample>({
      connectorClass: MailgunConnector,
      resource: 'events',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [eventCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ items: sample.items }));
        await makeConnector(['events']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented resource shapes', async () => {
    installFetchMock(() => ({
      items: [
        {
          dimensions: [
            { dimension: 'time', value: 'Wed, 03 Jun 2026 00:00:00 +0000' },
          ],
          metrics: { accepted_count: 10, delivered_count: 9, failed_count: 1 },
          id: 'evt_1',
          event: 'delivered',
          '@timestamp': '2026-06-03T10:00:00Z',
          recipient: 'user@dest.com',
        },
      ],
    }));

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      MailgunConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
