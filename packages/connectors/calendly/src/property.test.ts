import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  entityStoreFor,
  eventStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { CalendlyConnector } from './calendly';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    CalendlyConnector.resources,
    storage,
    connectorId,
  );

const CONNECTOR_ID = 'calendly';

const ORG = 'https://api.calendly.com/organizations/AAAAAAAAAAAAAAAA';

const CREDS = {
  apiToken: 'calendly_token' as unknown as { $secret: string },
};

type EventTypesSample = z.infer<typeof CalendlyConnector.schemas.event_types>;
type ScheduledEventsSample = z.infer<
  typeof CalendlyConnector.schemas.scheduled_events
>;

function makeConnector(
  resources: string[],
  extra: Record<string, unknown> = {},
): CalendlyConnector {
  return new CalendlyConnector(
    { organizationUri: ORG, resources: resources as never, ...extra } as never,
    CREDS,
  );
}

describe('CalendlyConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('event_types: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: EventTypesSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.collection.map((e) => e.uri)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('calendly_event_type')
          ?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one calendly_event_type entity per unique uri',
          location: 'event_types phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: CalendlyConnector,
      resource: 'event_types',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          ...sample,
          pagination: { next_page_token: null },
        }));
        await makeConnector(['event_types']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('scheduled_events: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: ScheduledEventsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const written = eventStoreFor(storage, CONNECTOR_ID).filter(
        (e) => (e as { name: string }).name === 'calendly_scheduled_event',
      ).length;
      if (written !== sample.collection.length) {
        violations.push({
          invariant: 'one calendly_scheduled_event per returned booking',
          location: 'scheduled_events phase',
          detail: `expected ${sample.collection.length} events, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: CalendlyConnector,
      resource: 'scheduled_events',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (/\/invitees/.test(url)) {
            return { collection: [], pagination: { next_page_token: null } };
          }
          return { ...sample, pagination: { next_page_token: null } };
        });
        await makeConnector(['scheduled_events']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('cancellations: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: CalendlyConnector,
      resource: 'scheduled_event_cancellations',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample: ScheduledEventsSample, storage) => {
        installFetchMock((url) => {
          if (/\/invitees/.test(url)) {
            return { collection: [], pagination: { next_page_token: null } };
          }
          return { ...sample, pagination: { next_page_token: null } };
        });
        await makeConnector(['cancellations']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('writes conform to declared resource shapes for a mixed full sync', async () => {
    const storage = new InMemoryStorage();
    installFetchMock((url) => {
      if (/\/invitees/.test(url)) {
        return {
          collection: [
            {
              uri: 'https://api.calendly.com/scheduled_events/SE1/invitees/IN1',
              email: 'ada@acme.test',
              name: 'Ada',
              status: 'active',
              created_at: '2024-06-01T00:00:00.000000Z',
              no_show: null,
            },
          ],
          pagination: { next_page_token: null },
        };
      }
      if (/\/scheduled_events/.test(url)) {
        return {
          collection: [
            {
              uri: 'https://api.calendly.com/scheduled_events/SE1',
              name: 'Intro',
              status: 'active',
              start_time: '2024-06-10T15:00:00.000000Z',
              end_time: '2024-06-10T15:30:00.000000Z',
              event_type: 'https://api.calendly.com/event_types/ET1',
            },
            {
              uri: 'https://api.calendly.com/scheduled_events/SE2',
              name: 'Canceled',
              status: 'canceled',
              start_time: '2024-06-11T15:00:00.000000Z',
              cancellation: {
                reason: 'conflict',
                canceled_by: 'Ada',
                canceler_type: 'invitee',
                created_at: '2024-06-05T00:00:00.000000Z',
              },
            },
          ],
          pagination: { next_page_token: null },
        };
      }
      return {
        collection: [
          {
            uri: 'https://api.calendly.com/event_types/ET1',
            name: '30 Minute Meeting',
            active: true,
            updated_at: '2024-02-01T00:00:00.000000Z',
          },
        ],
        pagination: { next_page_token: null },
      };
    });

    await new CalendlyConnector({ organizationUri: ORG } as never, CREDS).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      CalendlyConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
