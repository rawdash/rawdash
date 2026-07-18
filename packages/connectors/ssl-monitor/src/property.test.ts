import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { describe, it } from 'vitest';

import { type CertProbeOutcome, SslMonitorConnector } from './ssl-monitor';

const CONNECTOR_ID = 'ssl-monitor';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    SslMonitorConnector.resources,
    storage,
    connectorId,
  );

const probeReturning =
  (outcome: CertProbeOutcome) => (): Promise<CertProbeOutcome> =>
    Promise.resolve(outcome);

describe('SslMonitorConnector property tests', () => {
  it('sync upholds universal invariants for any probe outcome', async () => {
    await runPropertySyncTest({
      connectorClass: SslMonitorConnector,
      resource: 'ssl_probe',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [docShapeExtra],
      run: async (sample: CertProbeOutcome, storage) => {
        const connector = new SslMonitorConnector(
          { domains: [{ host: 'example.com' }] },
          undefined,
          undefined,
          probeReturning(sample),
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('incremental sync upholds universal invariants for any probe outcome', async () => {
    await runPropertySyncTest({
      connectorClass: SslMonitorConnector,
      resource: 'ssl_probe',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [docShapeExtra],
      run: async (sample: CertProbeOutcome, storage) => {
        const connector = new SslMonitorConnector(
          { domains: [{ host: 'example.com', port: 8443 }] },
          undefined,
          undefined,
          probeReturning(sample),
        );
        await connector.sync(
          { mode: 'latest' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across both resources matches documented shapes', async () => {
    const storage = new InMemoryStorage();
    const validTo = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const validFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const connector = new SslMonitorConnector(
      {
        domains: [{ host: 'example.com' }, { host: 'unreachable.example' }],
      },
      undefined,
      undefined,
      ({ host }) =>
        host === 'unreachable.example'
          ? Promise.resolve({
              ok: false,
              reason: 'unreachable',
              message: 'ECONNREFUSED',
            })
          : Promise.resolve({
              ok: true,
              authorizationError: null,
              certificate: {
                subjectCN: 'example.com',
                issuer: "Let's Encrypt",
                validFrom: validFrom.toUTCString(),
                validTo: validTo.toUTCString(),
                fingerprint: 'AA:BB',
                serialNumber: '01',
                subjectAltNames: ['DNS:example.com'],
              },
            }),
    );

    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      SslMonitorConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
