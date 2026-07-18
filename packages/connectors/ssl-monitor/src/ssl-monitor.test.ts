import { snapshotStorage } from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { describe, expect, it } from 'vitest';

import {
  type CertProbe,
  type CertProbeOutcome,
  SslMonitorConnector,
  type TlsCertificate,
  evaluateProbeOutcome,
} from './ssl-monitor';

const CONNECTOR_ID = 'ssl-monitor';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-18T00:00:00.000Z');

function certValidFor(days: number): TlsCertificate {
  return {
    subjectCN: 'example.com',
    issuer: "Let's Encrypt",
    validFrom: new Date(NOW - 30 * DAY).toUTCString(),
    validTo: new Date(NOW + days * DAY).toUTCString(),
    fingerprint: 'AA:BB:CC',
    serialNumber: '0123',
    subjectAltNames: ['DNS:example.com', 'DNS:www.example.com'],
  };
}

function okOutcome(
  cert: TlsCertificate,
  authorizationError: string | null = null,
): CertProbeOutcome {
  return { ok: true, certificate: cert, authorizationError };
}

const probeReturning =
  (outcome: CertProbeOutcome): CertProbe =>
  () =>
    Promise.resolve(outcome);

describe('evaluateProbeOutcome', () => {
  it('classifies a healthy certificate as ok', () => {
    const result = evaluateProbeOutcome(okOutcome(certValidFor(90)), 30, NOW);
    expect(result.status).toBe('ok');
    expect(result.daysUntilExpiry).toBe(90);
    expect(result.message).toBeNull();
  });

  it('classifies a certificate within the threshold as expiring_soon', () => {
    const result = evaluateProbeOutcome(okOutcome(certValidFor(10)), 30, NOW);
    expect(result.status).toBe('expiring_soon');
    expect(result.daysUntilExpiry).toBe(10);
  });

  it('uses the per-domain threshold boundary inclusively', () => {
    const result = evaluateProbeOutcome(okOutcome(certValidFor(30)), 30, NOW);
    expect(result.status).toBe('expiring_soon');
  });

  it('classifies a past validTo as expired', () => {
    const result = evaluateProbeOutcome(okOutcome(certValidFor(-1)), 30, NOW);
    expect(result.status).toBe('expired');
    expect(result.daysUntilExpiry).toBeLessThan(0);
    expect(result.message).toBe('certificate has expired');
  });

  it('classifies a not-yet-valid certificate as invalid', () => {
    const cert: TlsCertificate = {
      ...certValidFor(90),
      validFrom: new Date(NOW + 5 * DAY).toUTCString(),
    };
    const result = evaluateProbeOutcome(okOutcome(cert), 30, NOW);
    expect(result.status).toBe('invalid');
    expect(result.message).toBe('certificate is not yet valid');
  });

  it('classifies an untrusted-but-in-window certificate as invalid', () => {
    const result = evaluateProbeOutcome(
      okOutcome(certValidFor(90), 'SELF_SIGNED_CERT_IN_CHAIN'),
      30,
      NOW,
    );
    expect(result.status).toBe('invalid');
    expect(result.message).toBe('SELF_SIGNED_CERT_IN_CHAIN');
  });

  it('prefers the expired classification over an authorization error', () => {
    const result = evaluateProbeOutcome(
      okOutcome(certValidFor(-1), 'CERT_HAS_EXPIRED'),
      30,
      NOW,
    );
    expect(result.status).toBe('expired');
  });

  it('classifies an unparseable validity window as invalid', () => {
    const cert: TlsCertificate = {
      ...certValidFor(90),
      validTo: 'not a date',
    };
    const result = evaluateProbeOutcome(okOutcome(cert), 30, NOW);
    expect(result.status).toBe('invalid');
    expect(result.daysUntilExpiry).toBeNull();
  });

  it('classifies an unreachable host', () => {
    const result = evaluateProbeOutcome(
      { ok: false, reason: 'unreachable', message: 'ETIMEDOUT' },
      30,
      NOW,
    );
    expect(result.status).toBe('unreachable');
    expect(result.certificate).toBeNull();
    expect(result.message).toBe('ETIMEDOUT');
  });
});

describe('SslMonitorConnector.sync', () => {
  it('writes one certificate entity and one check event for a healthy host', async () => {
    const storage = new InMemoryStorage();
    const connector = new SslMonitorConnector(
      { domains: [{ host: 'example.com' }] },
      undefined,
      undefined,
      probeReturning(okOutcome(certValidFor(90))),
    );

    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const snap = snapshotStorage(storage, CONNECTOR_ID);
    expect(snap.entities).toHaveLength(1);
    expect(snap.entities[0]?.type).toBe('ssl_certificate');
    expect(snap.entities[0]?.id).toBe('example.com:443');
    expect(snap.entities[0]?.attributes.status).toBe('ok');
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]?.name).toBe('ssl_check');
    expect(snap.events[0]?.attributes.status).toBe('ok');
  });

  it('records an unreachable host as a check with no certificate entity', async () => {
    const storage = new InMemoryStorage();
    const connector = new SslMonitorConnector(
      { domains: [{ host: 'down.example' }] },
      undefined,
      undefined,
      probeReturning({
        ok: false,
        reason: 'unreachable',
        message: 'ECONNREFUSED',
      }),
    );

    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const snap = snapshotStorage(storage, CONNECTOR_ID);
    expect(snap.entities).toHaveLength(0);
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]?.attributes.status).toBe('unreachable');
    expect(snap.events[0]?.attributes.message).toBe('ECONNREFUSED');
  });

  it('honors the port and severity threshold per domain', async () => {
    const storage = new InMemoryStorage();
    const connector = new SslMonitorConnector(
      {
        domains: [
          { host: 'example.com', port: 8443, severityThresholdDays: 120 },
        ],
      },
      undefined,
      undefined,
      probeReturning(okOutcome(certValidFor(90))),
    );

    await connector.sync(
      { mode: 'latest' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const snap = snapshotStorage(storage, CONNECTOR_ID);
    expect(snap.entities[0]?.id).toBe('example.com:8443');
    expect(snap.entities[0]?.attributes.status).toBe('expiring_soon');
    expect(snap.entities[0]?.attributes.port).toBe(8443);
  });

  it('skips certificate entities when only checks are enabled', async () => {
    const storage = new InMemoryStorage();
    const connector = new SslMonitorConnector(
      { domains: [{ host: 'example.com' }], resources: ['checks'] },
      undefined,
      undefined,
      probeReturning(okOutcome(certValidFor(90))),
    );

    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const snap = snapshotStorage(storage, CONNECTOR_ID);
    expect(snap.entities).toHaveLength(0);
    expect(snap.events).toHaveLength(1);
  });

  it('preserves a prior certificate entity on an incremental sync when a host becomes unreachable', async () => {
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);

    const healthy = new SslMonitorConnector(
      { domains: [{ host: 'example.com' }] },
      undefined,
      undefined,
      probeReturning(okOutcome(certValidFor(90))),
    );
    await healthy.sync({ mode: 'full' }, handle);

    const flaky = new SslMonitorConnector(
      { domains: [{ host: 'example.com' }] },
      undefined,
      undefined,
      probeReturning({
        ok: false,
        reason: 'unreachable',
        message: 'ETIMEDOUT',
      }),
    );
    await flaky.sync({ mode: 'latest' }, handle);

    const snap = snapshotStorage(storage, CONNECTOR_ID);
    expect(snap.entities).toHaveLength(1);
    expect(snap.entities[0]?.attributes.status).toBe('ok');
    expect(snap.events).toHaveLength(2);
  });

  it('aborts promptly when the signal is already aborted', async () => {
    const storage = new InMemoryStorage();
    const connector = new SslMonitorConnector(
      { domains: [{ host: 'example.com' }] },
      undefined,
      undefined,
      probeReturning(okOutcome(certValidFor(90))),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      connector.sync(
        { mode: 'full' },
        storage.getStorageHandle(CONNECTOR_ID),
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});
