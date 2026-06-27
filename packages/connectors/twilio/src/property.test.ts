import { parseEpoch } from '@rawdash/connector-shared';
import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  eventStoreFor,
  installFetchMock,
  metricStoreFor,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { TwilioConnector, callStartTs, messageStartTs } from './twilio';

const CONNECTOR_ID = 'twilio';
const SECRET = 'auth_token_secret' as unknown as { $secret: string };
const BASE_SETTINGS = { accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' };

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    TwilioConnector.resources,
    storage,
    connectorId,
  );

type MessagesSample = z.infer<typeof TwilioConnector.schemas.messages>;
type CallsSample = z.infer<typeof TwilioConnector.schemas.calls>;
type UsageSample = z.infer<typeof TwilioConnector.schemas.usage_records>;

describe('TwilioConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('messages: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: MessagesSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const expected = sample.messages.filter(
        (m) => messageStartTs(m) !== null,
      ).length;
      const written = eventStoreFor(storage, CONNECTOR_ID).filter(
        (e) => e.name === 'twilio_message',
      ).length;
      if (written !== expected) {
        violations.push({
          invariant: 'one twilio_message per timestamped upstream message',
          location: 'messages phase',
          detail: `expected ${expected} events, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<MessagesSample>({
      connectorClass: TwilioConnector,
      resource: 'messages',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ ...sample, next_page_uri: null }));
        const c = new TwilioConnector(
          { ...BASE_SETTINGS, resources: ['twilio_message'] },
          { authToken: SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('calls: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: CallsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const expected = sample.calls.filter(
        (c) => callStartTs(c) !== null,
      ).length;
      const written = eventStoreFor(storage, CONNECTOR_ID).filter(
        (e) => e.name === 'twilio_call',
      ).length;
      if (written !== expected) {
        violations.push({
          invariant: 'one twilio_call per timestamped upstream call',
          location: 'calls phase',
          detail: `expected ${expected} events, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<CallsSample>({
      connectorClass: TwilioConnector,
      resource: 'calls',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ ...sample, next_page_uri: null }));
        const c = new TwilioConnector(
          { ...BASE_SETTINGS, resources: ['twilio_call'] },
          { authToken: SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('usage: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: UsageSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const expected = sample.usage_records.filter(
        (r) => parseEpoch(r.start_date ?? null, 'iso') !== null,
      ).length;
      const counts = metricStoreFor(storage, CONNECTOR_ID).filter(
        (m) => m.name === 'twilio_usage_count',
      ).length;
      const prices = metricStoreFor(storage, CONNECTOR_ID).filter(
        (m) => m.name === 'twilio_usage_price',
      ).length;
      if (counts !== expected || prices !== expected) {
        violations.push({
          invariant: 'one count and one price sample per dated usage record',
          location: 'usage phase',
          detail: `expected ${expected} of each, got counts=${counts} prices=${prices}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<UsageSample>({
      connectorClass: TwilioConnector,
      resource: 'usage_records',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ ...sample, next_page_uri: null }));
        const c = new TwilioConnector(
          {
            ...BASE_SETTINGS,
            resources: ['twilio_usage_count', 'twilio_usage_price'],
          },
          { authToken: SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('full sync writes match the documented resource shapes', async () => {
    const messagesBody = {
      messages: [
        {
          sid: 'SM1',
          status: 'delivered',
          error_code: null,
          direction: 'outbound-api',
          price: '-0.00750',
          price_unit: 'USD',
          date_sent: 'Mon, 01 Jan 2024 00:00:00 +0000',
          date_created: 'Mon, 01 Jan 2024 00:00:00 +0000',
          from: '+15551112222',
          to: '+15553334444',
          num_segments: '1',
          num_media: '0',
          messaging_service_sid: null,
        },
      ],
      next_page_uri: null,
    };
    const callsBody = {
      calls: [
        {
          sid: 'CA1',
          status: 'completed',
          direction: 'outbound-api',
          duration: '42',
          price: '-0.013',
          price_unit: 'USD',
          start_time: 'Mon, 01 Jan 2024 00:00:00 +0000',
          end_time: 'Mon, 01 Jan 2024 00:00:42 +0000',
          date_created: 'Mon, 01 Jan 2024 00:00:00 +0000',
          from: '+15551112222',
          to: '+15553334444',
        },
      ],
      next_page_uri: null,
    };
    const usageBody = {
      usage_records: [
        {
          category: 'sms',
          description: 'SMS',
          count: '120',
          count_unit: 'messages',
          usage: '120',
          usage_unit: 'messages',
          price: '-0.9',
          price_unit: 'USD',
          start_date: '2024-01-01',
          end_date: '2024-01-01',
        },
      ],
      next_page_uri: null,
    };

    installFetchMock((url) => {
      if (url.includes('/Messages.json')) {
        return messagesBody;
      }
      if (url.includes('/Calls.json')) {
        return callsBody;
      }
      if (url.includes('/Usage/Records/Daily.json')) {
        return usageBody;
      }
      return {
        messages: [],
        calls: [],
        usage_records: [],
        next_page_uri: null,
      };
    });

    const storage = new InMemoryStorage();
    const c = new TwilioConnector(BASE_SETTINGS, { authToken: SECRET });
    await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    assertConnectorResourceShapes(
      TwilioConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
