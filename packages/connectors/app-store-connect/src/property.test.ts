import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { AppStoreConnectConnector } from './app-store-connect';

const CONNECTOR_ID = 'app-store-connect';

async function generateTestP256Pem(): Promise<string> {
  const { privateKey } = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(
    await globalThis.crypto.subtle.exportKey('pkcs8', privateKey),
  );
  let binary = '';
  for (let i = 0; i < pkcs8.length; i++) {
    binary += String.fromCharCode(pkcs8[i]!);
  }
  const lines = btoa(binary).match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

const TEST_KEY = await generateTestP256Pem();
const SECRET = TEST_KEY as unknown as { $secret: string };

type AppsSample = z.infer<typeof AppStoreConnectConnector.schemas.apps>;

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    AppStoreConnectConnector.resources,
    storage,
    connectorId,
  );

describe('AppStoreConnectConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('apps: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<AppsSample>({
      connectorClass: AppStoreConnectConnector,
      resource: 'apps',
      connectorId: CONNECTOR_ID,
      runs: 25,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ ...sample, links: {} }));
        const c = new AppStoreConnectConnector(
          { resources: ['apps'] },
          {
            issuerId: '69a6de7f-0000-0000-0000-000000000000',
            keyId: 'ABC1234DEF',
            privateKey: SECRET,
          },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
