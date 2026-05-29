import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import type { z } from 'zod';

import { CloudWatchConnector } from './aws-cloudwatch';

const CONNECTOR_ID = 'aws-cloudwatch';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    CloudWatchConnector.resources,
    storage,
    connectorId,
  );

type MetricDataSample = z.infer<typeof CloudWatchConnector.schemas.metric_data>;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function serializeMetricData(sample: MetricDataSample): string {
  const members = sample.MetricDataResults.map(
    (r) =>
      `<member><Id>${escapeXml(r.Id)}</Id><Label>${escapeXml(r.Label)}</Label>` +
      `<Timestamps>${r.Timestamps.map((t) => `<member>${escapeXml(t)}</member>`).join('')}</Timestamps>` +
      `<Values>${r.Values.map((v) => `<member>${String(v)}</member>`).join('')}</Values>` +
      `<StatusCode>${r.StatusCode}</StatusCode></member>`,
  ).join('');
  // NextToken is intentionally omitted so each fuzzed response is a single page.
  return `<GetMetricDataResponse><GetMetricDataResult><MetricDataResults>${members}</MetricDataResults></GetMetricDataResult></GetMetricDataResponse>`;
}

function installXmlFetch(xml: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(xml, { headers: { 'content-type': 'text/xml' } }),
      ),
    ),
  );
}

describe('CloudWatchConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('metric_data: sync upholds universal invariants for any valid response', async () => {
    const expectedCount = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: MetricDataSample,
    ): InvariantViolation[] => {
      const expected = sample.MetricDataResults.reduce(
        (sum, r) => sum + Math.min(r.Timestamps.length, r.Values.length),
        0,
      );
      const written =
        (
          storage as unknown as {
            metricStore: Map<string, unknown[]>;
          }
        ).metricStore.get(CONNECTOR_ID)?.length ?? 0;
      if (written !== expected) {
        return [
          {
            invariant: 'one metric sample per paired (timestamp, value)',
            location: 'metric_data',
            detail: `expected ${expected} samples, got ${written}`,
          },
        ];
      }
      return [];
    };

    await runPropertySyncTest({
      connectorClass: CloudWatchConnector,
      resource: 'metric_data',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [expectedCount, docShapeExtra],
      run: async (sample, storage) => {
        // Give each result a clean id (the fuzzer otherwise produces ids with
        // whitespace/entities that the parser normalizes, breaking the
        // id<->query mapping) and a matching query, so every returned point
        // resolves to a metric stream.
        const results = sample.MetricDataResults.map((r, i) => ({
          ...r,
          Id: `q${i}`,
        }));
        installXmlFetch(serializeMetricData({ MetricDataResults: results }));
        const queries =
          results.length > 0
            ? results.map((r, i) => ({
                id: r.Id,
                namespace: 'AWS/Test',
                metric: `M${i}`,
                stat: 'Average',
                periodSeconds: 300,
              }))
            : [
                {
                  id: 'm0',
                  namespace: 'AWS/Test',
                  metric: 'M0',
                  stat: 'Average',
                  periodSeconds: 300,
                },
              ];
        const connector = new CloudWatchConnector(
          { region: 'us-east-1', metricQueries: queries },
          { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
        );
        await connector.sync(
          { mode: 'full', since: '2024-01-01T00:00:00Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
