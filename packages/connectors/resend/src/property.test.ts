import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import type { z } from 'zod';

import { ResendConnector } from './resend';

const CONNECTOR_ID = 'resend';
const KEY = 'RESEND_API_KEY' as unknown as { $secret: string };

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    ResendConnector.resources,
    storage,
    connectorId,
  );

type EmailsSample = z.infer<typeof ResendConnector.schemas.emails>;
type DomainsSample = z.infer<typeof ResendConnector.schemas.domains>;

function makeConnector(resources?: string[]) {
  return new ResendConnector(
    { resources: resources as never },
    { apiKey: KEY },
  );
}

describe('ResendConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('emails: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<EmailsSample>({
      connectorClass: ResendConnector,
      resource: 'emails',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ ...sample, has_more: false }));
        await makeConnector(['emails']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('domains: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<DomainsSample>({
      connectorClass: ResendConnector,
      resource: 'domains',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ ...sample, has_more: false }));
        await makeConnector(['domains']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented resource shapes', async () => {
    installFetchMock((url: string) => {
      if (url.includes('/emails')) {
        return {
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'e_1',
              message_id: '<m1@resend.dev>',
              from: 'Acme <hello@acme.com>',
              to: ['user@example.com'],
              cc: null,
              bcc: null,
              reply_to: null,
              subject: 'Welcome',
              created_at: '2026-01-15T10:00:00.000Z',
              last_event: 'delivered',
              scheduled_at: null,
            },
          ],
        };
      }
      return {
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'd_1',
            name: 'acme.com',
            status: 'verified',
            region: 'us-east-1',
            created_at: '2026-01-01T00:00:00.000Z',
            capabilities: { sending: 'enabled', receiving: 'disabled' },
          },
        ],
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      ResendConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
