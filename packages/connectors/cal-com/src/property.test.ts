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

import { CalComConnector } from './cal-com';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    CalComConnector.resources,
    storage,
    connectorId,
  );

const CONNECTOR_ID = 'cal-com';

const CREDS = {
  apiKey: 'cal_token' as unknown as { $secret: string },
};

type EventTypesSample = z.infer<typeof CalComConnector.schemas.event_types>;
type BookingsSample = z.infer<typeof CalComConnector.schemas.bookings>;

function makeConnector(
  resources: string[],
  extra: Record<string, unknown> = {},
): CalComConnector {
  return new CalComConnector(
    { resources: resources as never, ...extra } as never,
    CREDS,
  );
}

describe('CalComConnector property tests', () => {
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
      const unique = new Set(sample.data.map((e) => e.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('cal_com_event_type')?.size ??
        0;
      if (written !== unique) {
        violations.push({
          invariant: 'one cal_com_event_type entity per unique id',
          location: 'event_types phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: CalComConnector,
      resource: 'event_types',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (/\/v2\/me/.test(url)) {
            return { data: { username: 'acme' } };
          }
          return sample;
        });
        await makeConnector(['event_types']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('bookings: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: BookingsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const written = eventStoreFor(storage, CONNECTOR_ID).filter(
        (e) => (e as { name: string }).name === 'cal_com_booking',
      ).length;
      if (written !== sample.data.length) {
        violations.push({
          invariant: 'one cal_com_booking per returned booking',
          location: 'bookings phase',
          detail: `expected ${sample.data.length} events, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: CalComConnector,
      resource: 'bookings',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          ...sample,
          pagination: { nextCursor: null, hasMore: false },
        }));
        await makeConnector(['bookings']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('cancellations: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: CalComConnector,
      resource: 'booking_cancellations',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample: BookingsSample, storage) => {
        installFetchMock(() => ({
          ...sample,
          pagination: { nextCursor: null, hasMore: false },
        }));
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
      if (/\/v2\/me/.test(url)) {
        return { data: { username: 'acme' } };
      }
      if (/\/v2\/bookings/.test(url)) {
        return {
          data: [
            {
              id: 1,
              uid: 'bk_1',
              title: 'Intro',
              status: 'accepted',
              start: '2024-06-10T15:00:00.000Z',
              end: '2024-06-10T15:30:00.000Z',
              eventType: { id: 101, slug: '30min' },
              attendees: [{ email: 'ada@acme.test', absent: false }],
            },
            {
              id: 2,
              uid: 'bk_2',
              title: 'Canceled',
              status: 'cancelled',
              start: '2024-06-11T15:00:00.000Z',
              cancellationReason: 'conflict',
              cancelledByEmail: 'ada@acme.test',
              updatedAt: '2024-06-05T00:00:00.000Z',
            },
          ],
          pagination: { nextCursor: null, hasMore: false },
        };
      }
      return {
        data: [
          {
            id: 101,
            title: '30 Minute Meeting',
            slug: '30min',
            lengthInMinutes: 30,
            hidden: false,
          },
        ],
      };
    });

    await new CalComConnector({} as never, CREDS).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      CalComConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
