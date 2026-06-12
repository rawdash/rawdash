import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import type { z } from 'zod';

import {
  AwsBedrockConnector,
  ERRORS_METRIC,
  INPUT_TOKENS_METRIC,
  INVOCATIONS_METRIC,
  LATENCY_METRIC,
  OUTPUT_TOKENS_METRIC,
  SPEND_METRIC,
} from './aws-bedrock';

const CONNECTOR_ID = 'aws-bedrock';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    AwsBedrockConnector.resources,
    storage,
    connectorId,
  );

type UsageSample = z.infer<typeof AwsBedrockConnector.schemas.usage>;
type SpendSample = z.infer<typeof AwsBedrockConnector.schemas.spend>;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function serializeMetricData(sample: UsageSample): string {
  const members = sample.MetricDataResults.map(
    (r) =>
      `<member><Id>${escapeXml(r.Id)}</Id><Label>${escapeXml(r.Label)}</Label>` +
      `<Timestamps>${r.Timestamps.map((t) => `<member>${escapeXml(t)}</member>`).join('')}</Timestamps>` +
      `<Values>${r.Values.map((v) => `<member>${String(v)}</member>`).join('')}</Values>` +
      `<StatusCode>${r.StatusCode}</StatusCode></member>`,
  ).join('');
  return `<GetMetricDataResponse><GetMetricDataResult><MetricDataResults>${members}</MetricDataResults></GetMetricDataResult></GetMetricDataResponse>`;
}

const LIST_METRICS_XML = `<ListMetricsResponse><ListMetricsResult><Metrics>
  <member>
    <Namespace>AWS/Bedrock</Namespace>
    <MetricName>Invocations</MetricName>
    <Dimensions>
      <member><Name>ModelId</Name><Value>anthropic.claude-3-sonnet-20240229-v1:0</Value></member>
    </Dimensions>
  </member>
</Metrics></ListMetricsResult></ListMetricsResponse>`;

function installMetricFetch(xml: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const body = String(init.body ?? '');
      if (body.includes('Action=ListMetrics')) {
        return Promise.resolve(
          new Response(LIST_METRICS_XML, {
            headers: { 'content-type': 'text/xml' },
          }),
        );
      }
      if (String(url).startsWith('https://ce.us-east-1')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ResultsByTime: [] }), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(xml, { headers: { 'content-type': 'text/xml' } }),
      );
    }),
  );
}

function installSpendFetch(json: SpendSample): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const body = String(init.body ?? '');
      if (body.includes('Action=ListMetrics')) {
        return Promise.resolve(
          new Response(
            '<ListMetricsResponse><ListMetricsResult><Metrics></Metrics></ListMetricsResult></ListMetricsResponse>',
            {
              headers: { 'content-type': 'text/xml' },
            },
          ),
        );
      }
      if (String(url).startsWith('https://ce.us-east-1')) {
        const payload = { ...json };
        delete (payload as { NextPageToken?: string }).NextPageToken;
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response('<response/>', {
          headers: { 'content-type': 'text/xml' },
        }),
      );
    }),
  );
}

function makeConnector(): AwsBedrockConnector {
  return new AwsBedrockConnector(
    {
      region: 'us-east-1',
      modelIds: ['anthropic.claude-3-sonnet-20240229-v1:0'],
    },
    { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
  );
}

describe('AwsBedrockConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('usage: sync upholds universal invariants for any valid GetMetricData response', async () => {
    await runPropertySyncTest({
      connectorClass: AwsBedrockConnector,
      resource: 'usage',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        const usageSample = sample as UsageSample;
        const remapped: UsageSample = {
          MetricDataResults: usageSample.MetricDataResults.map((r, i) => ({
            ...r,
            Id: `u${i}`,
          })),
        };
        installMetricFetch(serializeMetricData(remapped));
        await makeConnector().sync(
          {
            mode: 'full',
            since: '2025-01-01T00:00:00Z',
            resources: new Set([
              INVOCATIONS_METRIC,
              INPUT_TOKENS_METRIC,
              OUTPUT_TOKENS_METRIC,
              LATENCY_METRIC,
            ]),
          },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('errors: sync upholds universal invariants for any valid GetMetricData response', async () => {
    await runPropertySyncTest({
      connectorClass: AwsBedrockConnector,
      resource: 'errors',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        const usageSample = sample as UsageSample;
        const remapped: UsageSample = {
          MetricDataResults: usageSample.MetricDataResults.map((r, i) => ({
            ...r,
            Id: `e${i}`,
          })),
        };
        installMetricFetch(serializeMetricData(remapped));
        await makeConnector().sync(
          {
            mode: 'full',
            since: '2025-01-01T00:00:00Z',
            resources: new Set([ERRORS_METRIC]),
          },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('spend: sync upholds universal invariants for any valid Cost Explorer payload', async () => {
    await runPropertySyncTest({
      connectorClass: AwsBedrockConnector,
      resource: 'spend',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installSpendFetch(sample as SpendSample);
        await makeConnector().sync(
          { mode: 'full', resources: new Set([SPEND_METRIC]) },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
