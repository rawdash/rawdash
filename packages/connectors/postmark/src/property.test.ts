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

import { PostmarkConnector } from './postmark';

const CONNECTOR_ID = 'postmark';
const TOKEN = 'POSTMARK_SERVER_TOKEN' as unknown as { $secret: string };

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] => [
  ...connectorResourceShapeViolations(
    PostmarkConnector.resources,
    storage,
    connectorId,
  ),
  ...connectorMetricConformanceViolations(
    PostmarkConnector.resources,
    storage,
    connectorId,
  ),
];

type SendsSample = z.infer<typeof PostmarkConnector.schemas.email_stats_sends>;
type BouncesSample = z.infer<typeof PostmarkConnector.schemas.bounces>;

function makeConnector(resources?: string[]) {
  return new PostmarkConnector(
    { resources: resources as never, lookbackDays: 30 },
    { serverToken: TOKEN },
  );
}

function distinctDateCount(sample: SendsSample): number {
  return new Set(sample.Days.map((d) => d.Date)).size;
}

function statsSampleCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: SendsSample,
): InvariantViolation[] {
  const expected = distinctDateCount(sample);
  const samples = metricStoreFor(storage, connectorId).filter(
    (m) => m.name === 'postmark_email_stats',
  );
  if (samples.length !== expected) {
    return [
      {
        invariant: 'one postmark_email_stats sample per distinct stats date',
        location: 'email_stats phase',
        detail: `expected ${expected} metrics, got ${samples.length}`,
      },
    ];
  }
  return [];
}

function bounceEventCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: BouncesSample,
): InvariantViolation[] {
  const events = eventStoreFor<{ name: string }>(storage, connectorId).filter(
    (e) => e.name === 'postmark_bounce',
  );
  if (events.length !== sample.Bounces.length) {
    return [
      {
        invariant: 'one postmark_bounce event per bounce record',
        location: 'bounces phase',
        detail: `expected ${sample.Bounces.length} events, got ${events.length}`,
      },
    ];
  }
  return [];
}

describe('PostmarkConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('email_stats: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<SendsSample>({
      connectorClass: PostmarkConnector,
      resource: 'email_stats_sends',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [statsSampleCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url: string) => {
          if (url.includes('/stats/outbound/sends')) {
            return sample;
          }
          return { Days: [] };
        });
        await makeConnector(['email_stats']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('bounces: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<BouncesSample>({
      connectorClass: PostmarkConnector,
      resource: 'bounces',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [bounceEventCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        await makeConnector(['bounces']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented resource shapes', async () => {
    installFetchMock((url: string) => {
      if (url.includes('/stats/outbound/sends')) {
        return { Sent: 100, Days: [{ Date: '2025-01-15', Sent: 100 }] };
      }
      if (url.includes('/stats/outbound/bounces')) {
        return {
          HardBounce: 2,
          Days: [{ Date: '2025-01-15', HardBounce: 2, SoftBounce: 1 }],
        };
      }
      if (url.includes('/stats/outbound/spam')) {
        return {
          SpamComplaint: 1,
          Days: [{ Date: '2025-01-15', SpamComplaint: 1 }],
        };
      }
      if (url.includes('/stats/outbound/opens')) {
        return {
          Opens: 40,
          Unique: 30,
          Days: [{ Date: '2025-01-15', Opens: 40, Unique: 30 }],
        };
      }
      if (url.includes('/bounces')) {
        return {
          TotalCount: 1,
          Bounces: [
            {
              ID: 1,
              Type: 'HardBounce',
              TypeCode: 1,
              Name: 'Hard bounce',
              Tag: 'welcome',
              MessageID: 'm_1',
              ServerID: 99,
              MessageStream: 'outbound',
              Description: 'The server was unable to deliver your message.',
              Details: 'mailbox does not exist',
              Email: 'user@example.com',
              From: 'sender@example.com',
              BouncedAt: '2025-01-15T10:00:00Z',
              DumpAvailable: true,
              Inactive: true,
              CanActivate: true,
              Subject: 'Welcome',
            },
          ],
        };
      }
      return {};
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      PostmarkConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
