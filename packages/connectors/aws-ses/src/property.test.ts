import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';

import { AwsSesConnector } from './aws-ses';

const CONNECTOR_ID = 'aws-ses';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    AwsSesConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(): AwsSesConnector {
  return new AwsSesConnector(
    { region: 'us-east-1' },
    {
      accessKeyId: 'AKIAEXAMPLE' as unknown as { $secret: string },
      secretAccessKey: 'secret' as unknown as { $secret: string },
    },
  );
}

function metricDataXml(sample: unknown): string {
  const body = sample as {
    MetricDataResults?: Array<{
      Id?: unknown;
      Label?: unknown;
      Timestamps?: unknown;
      Values?: unknown;
      StatusCode?: unknown;
    }>;
  };
  const members = (body.MetricDataResults ?? [])
    .map((r, index) => {
      const timestamps = Array.isArray(r.Timestamps) ? r.Timestamps : [];
      const values = Array.isArray(r.Values) ? r.Values : [];
      return `<member>
        <Id>m${index}</Id>
        <Label>${String(r.Label ?? '')}</Label>
        <Timestamps>${timestamps.map((t) => `<member>${String(t)}</member>`).join('')}</Timestamps>
        <Values>${values.map((v) => `<member>${String(v)}</member>`).join('')}</Values>
        <StatusCode>Complete</StatusCode>
      </member>`;
    })
    .join('');
  return `<GetMetricDataResponse><GetMetricDataResult><MetricDataResults>${members}</MetricDataResults></GetMetricDataResult></GetMetricDataResponse>`;
}

function installMock(sample: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(metricDataXml(sample), {
          status: 200,
          headers: { 'content-type': 'text/xml' },
        }),
      ),
    ),
  );
}

describe('AwsSesConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('email_stats: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: AwsSesConnector,
      resource: 'email_stats',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector().sync(
          { mode: 'full', since: '2024-01-01T00:00:00Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('reputation: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: AwsSesConnector,
      resource: 'reputation',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector().sync(
          { mode: 'full', since: '2024-01-01T00:00:00Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
