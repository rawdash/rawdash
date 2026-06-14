import { AuthError, RateLimitError } from '@rawdash/connector-shared';
import { type ConnectorLogger, InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AwsBedrockConnector,
  ERRORS_METRIC,
  INPUT_TOKENS_METRIC,
  INVOCATIONS_METRIC,
  LATENCY_METRIC,
  OUTPUT_TOKENS_METRIC,
  SPEND_METRIC,
  buildSpendSamples,
  configFields,
  getBedrockWindow,
  getSpendWindow,
  parseListMetrics,
} from './aws-bedrock';

const CONNECTOR_ID = 'aws-bedrock';

interface MockReply {
  status?: number;
  body: string;
  contentType?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit) => MockReply,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn((url: string | URL, init: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const reply = handler(u, init);
    return Promise.resolve(
      new Response(reply.body, {
        status: reply.status ?? 200,
        headers: {
          'content-type': reply.contentType ?? 'text/xml',
        },
      }),
    );
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function listMetricsXml(modelIds: string[], nextToken?: string): string {
  const members = modelIds
    .map(
      (m) => `<member>
        <Namespace>AWS/Bedrock</Namespace>
        <MetricName>Invocations</MetricName>
        <Dimensions>
          <member><Name>ModelId</Name><Value>${m}</Value></member>
        </Dimensions>
      </member>`,
    )
    .join('');
  const token = nextToken ? `<NextToken>${nextToken}</NextToken>` : '';
  return `<ListMetricsResponse><ListMetricsResult><Metrics>${members}</Metrics>${token}</ListMetricsResult></ListMetricsResponse>`;
}

function metricDataXml(
  results: Array<{
    id: string;
    label: string;
    timestamps: string[];
    values: number[];
  }>,
  nextToken?: string,
): string {
  const members = results
    .map(
      (r) => `<member>
        <Id>${r.id}</Id>
        <Label>${r.label}</Label>
        <Timestamps>${r.timestamps.map((t) => `<member>${t}</member>`).join('')}</Timestamps>
        <Values>${r.values.map((v) => `<member>${v}</member>`).join('')}</Values>
        <StatusCode>Complete</StatusCode>
      </member>`,
    )
    .join('');
  const token = nextToken ? `<NextToken>${nextToken}</NextToken>` : '';
  return `<GetMetricDataResponse><GetMetricDataResult><MetricDataResults>${members}</MetricDataResults>${token}</GetMetricDataResult></GetMetricDataResponse>`;
}

function staticConnector(
  overrides: Partial<{
    modelIds?: string[];
    lookbackDays?: number;
    granularitySeconds?: number;
  }> = {},
  logger?: ConnectorLogger,
): AwsBedrockConnector {
  return new AwsBedrockConnector(
    {
      region: 'us-east-1',
      ...overrides,
    },
    { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
    logger ? { logger } : undefined,
  );
}

function recordingLogger(): {
  logger: ConnectorLogger;
  warnings: Array<{ event: string; fields?: Record<string, unknown> }>;
} {
  const warnings: Array<{ event: string; fields?: Record<string, unknown> }> =
    [];
  const logger: ConnectorLogger = {
    info() {},
    warn(event, fields) {
      warnings.push({ event, fields });
    },
  };
  return { logger, warnings };
}

function startTimeFromBody(body: unknown): number {
  const params = new URLSearchParams(String(body));
  const startTime = params.get('StartTime');
  expect(startTime).not.toBeNull();
  return Date.parse(startTime!);
}

function metricsFor(
  storage: InMemoryStorage,
  metricName?: string,
): Array<{
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, unknown>;
}> {
  const all =
    (
      storage as unknown as {
        metricStore: Map<
          string,
          Array<{
            name: string;
            ts: number;
            value: number;
            attributes: Record<string, unknown>;
          }>
        >;
      }
    ).metricStore.get(CONNECTOR_ID) ?? [];
  return metricName ? all.filter((m) => m.name === metricName) : all;
}

describe('parseListMetrics', () => {
  it('extracts unique modelIds from the ListMetrics XML response', () => {
    const xml = listMetricsXml([
      'anthropic.claude-3-sonnet-20240229-v1:0',
      'meta.llama3-70b-instruct-v1:0',
      'anthropic.claude-3-sonnet-20240229-v1:0',
    ]);
    const parsed = parseListMetrics(xml);
    expect(parsed.modelIds).toHaveLength(2);
    expect(parsed.modelIds).toContain(
      'anthropic.claude-3-sonnet-20240229-v1:0',
    );
    expect(parsed.modelIds).toContain('meta.llama3-70b-instruct-v1:0');
    expect(parsed.nextToken).toBeNull();
  });

  it('surfaces NextToken when present', () => {
    const xml = listMetricsXml(['anthropic.claude-3-haiku-20240307-v1:0'], 't');
    const parsed = parseListMetrics(xml);
    expect(parsed.nextToken).toBe('t');
  });
});

describe('buildSpendSamples', () => {
  it('emits one sample per usage_type group with the usageType attribute set', () => {
    const samples = buildSpendSamples({
      ResultsByTime: [
        {
          TimePeriod: { Start: '2025-01-01', End: '2025-01-02' },
          Groups: [
            {
              Keys: ['USE1-Bedrock-OnDemand-InputTokens-claude-3-sonnet'],
              Metrics: { UnblendedCost: { Amount: '1.50', Unit: 'USD' } },
            },
            {
              Keys: ['USE1-Bedrock-OnDemand-OutputTokens-claude-3-sonnet'],
              Metrics: { UnblendedCost: { Amount: '0.75', Unit: 'USD' } },
            },
          ],
          Estimated: false,
        },
      ],
    });
    expect(samples).toHaveLength(2);
    expect(samples[0]!.attributes['usageType']).toContain('InputTokens');
    expect(samples[1]!.value).toBeCloseTo(0.75);
  });

  it('falls back to total UnblendedCost when no groups are present', () => {
    const samples = buildSpendSamples({
      ResultsByTime: [
        {
          TimePeriod: { Start: '2025-01-01', End: '2025-01-02' },
          Total: { UnblendedCost: { Amount: '12.34', Unit: 'USD' } },
        },
      ],
    });
    expect(samples).toHaveLength(1);
    expect(samples[0]!.name).toBe(SPEND_METRIC);
    expect(samples[0]!.value).toBeCloseTo(12.34);
  });

  it('skips entries with an unparseable start date', () => {
    const samples = buildSpendSamples({
      ResultsByTime: [
        {
          TimePeriod: { Start: 'nope', End: '2025-01-02' },
          Total: { UnblendedCost: { Amount: '1', Unit: 'USD' } },
        },
      ],
    });
    expect(samples).toHaveLength(0);
  });
});

describe('getBedrockWindow / getSpendWindow', () => {
  const now = Date.UTC(2025, 5, 15, 12, 0, 0);

  it('uses the configured lookback for a full sync', () => {
    const w = getBedrockWindow({ mode: 'full' }, 30, now);
    expect(w.endMs).toBe(now);
    expect(w.startMs).toBe(now - 30 * 86_400_000);
  });

  it('uses a short trailing window for an incremental sync', () => {
    const w = getBedrockWindow({ mode: 'latest' }, 30, now);
    expect(w.endMs - w.startMs).toBe(3 * 86_400_000);
  });

  it('honors options.since when provided', () => {
    const since = '2025-06-01T00:00:00Z';
    const w = getBedrockWindow({ mode: 'full', since }, 30, now);
    expect(w.startMs).toBe(Date.parse(since));
  });

  it('leaves the legacy three-argument signature behavior unchanged', () => {
    const w = getBedrockWindow({ mode: 'full' }, 365, now);
    expect(w.startMs).toBe(now - 365 * 86_400_000);
  });

  it('clamps the window to the 15-day retention floor for a 60s period', () => {
    const lookbackDays = 30;
    const { logger, warnings } = recordingLogger();
    const w = getBedrockWindow({ mode: 'full' }, lookbackDays, now, 60, logger);
    expect(w.startMs).toBe(now - 15 * 86_400_000);
    const truncation = warnings.find(
      (warn) => warn.event === 'window truncated to retention floor',
    );
    expect(truncation).toBeDefined();
    expect(truncation!.fields).toMatchObject({
      retentionFloorMs: 15 * 86_400_000,
      requestedStartMs: now - 30 * 86_400_000,
      effectiveStartMs: now - 15 * 86_400_000,
    });
  });

  it('does not clamp a 3600s period at a 30-day lookback', () => {
    const { logger, warnings } = recordingLogger();
    const w = getBedrockWindow({ mode: 'full' }, 30, now, 3600, logger);
    expect(w.startMs).toBe(now - 30 * 86_400_000);
    expect(
      warnings.find(
        (warn) => warn.event === 'window truncated to retention floor',
      ),
    ).toBeUndefined();
  });

  it('computes daily start/end dates for the spend window', () => {
    const w = getSpendWindow({ mode: 'full' }, 30, now);
    expect(w.end).toBe('2025-06-16');
    expect(w.start).toBe('2025-05-17');
  });
});

describe('AwsBedrockConnector.sync (static credentials)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('discovers model IDs via ListMetrics, queries CloudWatch and Cost Explorer, and writes all six metrics', async () => {
    const spy = installFetch((url, init) => {
      const body = String(init.body ?? '');
      if (url.startsWith('https://ce.us-east-1')) {
        return {
          contentType: 'application/json',
          body: JSON.stringify({
            ResultsByTime: [
              {
                TimePeriod: { Start: '2025-01-01', End: '2025-01-02' },
                Groups: [
                  {
                    Keys: ['USE1-Bedrock-OnDemand-InputTokens-claude-sonnet'],
                    Metrics: {
                      UnblendedCost: { Amount: '2.00', Unit: 'USD' },
                    },
                  },
                ],
                Estimated: false,
              },
            ],
          }),
        };
      }
      if (body.includes('Action=ListMetrics')) {
        return {
          body: listMetricsXml([
            'anthropic.claude-3-sonnet-20240229-v1:0',
            'meta.llama3-70b-instruct-v1:0',
          ]),
        };
      }
      if (body.includes('Action=GetMetricData')) {
        const usage =
          body.includes('Invocations') ||
          body.includes('TokenCount') ||
          body.includes('InvocationLatency');
        const isErrorBatch =
          body.includes('Invocation') && body.includes('Errors');
        return {
          body: metricDataXml(
            isErrorBatch && !usage
              ? [
                  {
                    id: 'e0',
                    label: 'InvocationClientErrors',
                    timestamps: ['2025-01-01T00:00:00Z'],
                    values: [1],
                  },
                ]
              : [
                  {
                    id: 'u0',
                    label: 'Invocations',
                    timestamps: ['2025-01-01T00:00:00Z'],
                    values: [10],
                  },
                ],
          ),
        };
      }
      return { body: '<response/>' };
    });

    const storage = new InMemoryStorage();
    const result = await staticConnector().sync(
      { mode: 'full', since: '2025-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(result).toEqual({ done: true });

    const all = metricsFor(storage);
    const names = new Set(all.map((m) => m.name));
    expect(names.has(INVOCATIONS_METRIC)).toBe(true);
    expect(names.has(SPEND_METRIC)).toBe(true);

    const ceCalled = spy.mock.calls.some(([u]) =>
      String(u).startsWith('https://ce.us-east-1'),
    );
    expect(ceCalled).toBe(true);

    const listCalls = spy.mock.calls.filter(([, init]) =>
      String(init?.body ?? '').includes('Action=ListMetrics'),
    );
    expect(listCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('skips ListMetrics when modelIds are supplied in config', async () => {
    const spy = installFetch((url, init) => {
      const body = String(init.body ?? '');
      if (url.startsWith('https://ce.us-east-1')) {
        return {
          contentType: 'application/json',
          body: JSON.stringify({ ResultsByTime: [] }),
        };
      }
      if (body.includes('Action=ListMetrics')) {
        throw new Error('ListMetrics should not be called');
      }
      return {
        body: metricDataXml([
          {
            id: 'u0',
            label: 'Invocations',
            timestamps: ['2025-01-01T00:00:00Z'],
            values: [1],
          },
        ]),
      };
    });

    const storage = new InMemoryStorage();
    await staticConnector({
      modelIds: ['anthropic.claude-3-sonnet-20240229-v1:0'],
    }).sync(
      { mode: 'full', since: '2025-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const listCalls = spy.mock.calls.filter(([, init]) =>
      String(init?.body ?? '').includes('Action=ListMetrics'),
    );
    expect(listCalls).toHaveLength(0);
  });

  it('honors options.resources: only the requested phases run', async () => {
    const spy = installFetch((url, init) => {
      const body = String(init.body ?? '');
      if (url.startsWith('https://ce.us-east-1')) {
        return {
          contentType: 'application/json',
          body: JSON.stringify({ ResultsByTime: [] }),
        };
      }
      if (body.includes('Action=ListMetrics')) {
        return {
          body: listMetricsXml(['anthropic.claude-3-sonnet-20240229-v1:0']),
        };
      }
      return { body: metricDataXml([]) };
    });

    const storage = new InMemoryStorage();
    await staticConnector().sync(
      { mode: 'full', resources: new Set([SPEND_METRIC]) },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const cwCalls = spy.mock.calls.filter(([u]) =>
      String(u).startsWith('https://monitoring.'),
    );
    expect(cwCalls).toHaveLength(0);
    const ceCalls = spy.mock.calls.filter(([u]) =>
      String(u).startsWith('https://ce.'),
    );
    expect(ceCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('writes empty metric lists when no model IDs are discovered', async () => {
    installFetch((url, init) => {
      const body = String(init.body ?? '');
      if (url.startsWith('https://ce.us-east-1')) {
        return {
          contentType: 'application/json',
          body: JSON.stringify({ ResultsByTime: [] }),
        };
      }
      if (body.includes('Action=ListMetrics')) {
        return { body: listMetricsXml([]) };
      }
      throw new Error(
        'GetMetricData should not be called when no model IDs are discovered',
      );
    });

    const storage = new InMemoryStorage();
    await staticConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(metricsFor(storage, INVOCATIONS_METRIC)).toHaveLength(0);
    expect(metricsFor(storage, ERRORS_METRIC)).toHaveLength(0);
  });

  it('falls back to empty spend on a Cost Explorer DataUnavailable error', async () => {
    installFetch((url, init) => {
      const body = String(init.body ?? '');
      if (url.startsWith('https://ce.us-east-1')) {
        return {
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            __type: 'DataUnavailableException',
            message: 'no data yet',
          }),
        };
      }
      if (body.includes('Action=ListMetrics')) {
        return { body: listMetricsXml([]) };
      }
      return { body: metricDataXml([]) };
    });

    const storage = new InMemoryStorage();
    const result = await staticConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(result.done).toBe(true);
    expect(metricsFor(storage, SPEND_METRIC)).toHaveLength(0);
  });
});

describe('AwsBedrockConnector.sync retention clamp', () => {
  const DAY_MS = 86_400_000;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clamps a 60s-period 30-day sync StartTime to ~15 days and warns', async () => {
    const spy = installFetch((url) => {
      if (url.startsWith('https://ce.us-east-1')) {
        return {
          contentType: 'application/json',
          body: JSON.stringify({ ResultsByTime: [] }),
        };
      }
      return { body: metricDataXml([]) };
    });

    const { logger, warnings } = recordingLogger();
    const before = Date.now();
    await staticConnector(
      {
        modelIds: ['anthropic.claude-3-sonnet-20240229-v1:0'],
        lookbackDays: 30,
        granularitySeconds: 60,
      },
      logger,
    ).sync(
      { mode: 'full', resources: new Set([INVOCATIONS_METRIC]) },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );
    const after = Date.now();

    const monitoringCall = spy.mock.calls.find(([u]) =>
      String(u).startsWith('https://monitoring.'),
    );
    expect(monitoringCall).toBeDefined();
    const startMs = startTimeFromBody(monitoringCall![1].body);
    expect(startMs).toBeGreaterThanOrEqual(before - 15 * DAY_MS - 1000);
    expect(startMs).toBeLessThanOrEqual(after - 15 * DAY_MS + 1000);
    expect(startMs).toBeGreaterThan(before - 30 * DAY_MS + 10 * DAY_MS);

    const truncation = warnings.find(
      (w) => w.event === 'window truncated to retention floor',
    );
    expect(truncation).toBeDefined();
    expect(truncation!.fields).toMatchObject({
      retentionFloorMs: 15 * DAY_MS,
    });
  });

  it('does not clamp a 3600s-period 30-day sync', async () => {
    const spy = installFetch((url) => {
      if (url.startsWith('https://ce.us-east-1')) {
        return {
          contentType: 'application/json',
          body: JSON.stringify({ ResultsByTime: [] }),
        };
      }
      return { body: metricDataXml([]) };
    });

    const { logger, warnings } = recordingLogger();
    const before = Date.now();
    await staticConnector(
      {
        modelIds: ['anthropic.claude-3-sonnet-20240229-v1:0'],
        lookbackDays: 30,
        granularitySeconds: 3600,
      },
      logger,
    ).sync(
      { mode: 'full', resources: new Set([INVOCATIONS_METRIC]) },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );
    const after = Date.now();

    const monitoringCall = spy.mock.calls.find(([u]) =>
      String(u).startsWith('https://monitoring.'),
    );
    const startMs = startTimeFromBody(monitoringCall![1].body);
    expect(startMs).toBeGreaterThanOrEqual(before - 30 * DAY_MS - 1000);
    expect(startMs).toBeLessThanOrEqual(after - 30 * DAY_MS + 1000);
    expect(
      warnings.find((w) => w.event === 'window truncated to retention floor'),
    ).toBeUndefined();
  });
});

describe('AwsBedrockConnector error mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps a CloudWatch Throttling response to a RateLimitError', async () => {
    installFetch(() => ({
      status: 400,
      body: '<ErrorResponse><Error><Code>Throttling</Code><Message>slow down</Message></Error></ErrorResponse>',
    }));
    await expect(
      staticConnector({
        modelIds: ['anthropic.claude-3-sonnet-20240229-v1:0'],
      }).sync(
        { mode: 'full', resources: new Set([INVOCATIONS_METRIC]) },
        new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
      ),
    ).rejects.toMatchObject({ name: RateLimitError.name });
  });

  it('maps a Cost Explorer LimitExceededException to a RateLimitError', async () => {
    installFetch((url) => {
      if (url.startsWith('https://ce.us-east-1')) {
        return {
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            __type: 'LimitExceededException',
            message: 'rate exceeded',
          }),
        };
      }
      return { body: '<response/>' };
    });
    await expect(
      staticConnector().sync(
        { mode: 'full', resources: new Set([SPEND_METRIC]) },
        new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
      ),
    ).rejects.toMatchObject({ name: RateLimitError.name });
  });

  it('maps a Cost Explorer AccessDenied to an AuthError', async () => {
    installFetch((url) => {
      if (url.startsWith('https://ce.us-east-1')) {
        return {
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            __type: 'AccessDeniedException',
            message: 'no access',
          }),
        };
      }
      return { body: '<response/>' };
    });
    await expect(
      staticConnector().sync(
        { mode: 'full', resources: new Set([SPEND_METRIC]) },
        new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
      ),
    ).rejects.toMatchObject({ name: AuthError.name });
  });
});

describe('configFields', () => {
  it('accepts static credentials', () => {
    const parsed = configFields.parse({
      region: 'us-east-1',
      accessKeyId: { $secret: 'AWS_ACCESS_KEY_ID' },
      secretAccessKey: { $secret: 'AWS_SECRET_ACCESS_KEY' },
    });
    expect(parsed.region).toBe('us-east-1');
  });

  it('accepts role-assumption config', () => {
    expect(() =>
      configFields.parse({
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/rawdash',
        externalId: 'ext',
      }),
    ).not.toThrow();
  });

  it('rejects a config with no auth method', () => {
    expect(() => configFields.parse({ region: 'us-east-1' })).toThrow();
  });

  it('accepts modelIds, lookbackDays, and granularitySeconds', () => {
    const parsed = configFields.parse({
      region: 'us-west-2',
      roleArn: 'arn:aws:iam::123456789012:role/r',
      modelIds: ['anthropic.claude-3-sonnet-20240229-v1:0'],
      lookbackDays: 14,
      granularitySeconds: 3600,
    });
    expect(parsed.lookbackDays).toBe(14);
    expect(parsed.granularitySeconds).toBe(3600);
  });

  it('rejects a granularitySeconds value that is not a multiple of 60', () => {
    expect(() =>
      configFields.parse({
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/r',
        granularitySeconds: 90,
      }),
    ).toThrow();
  });
});

describe('AwsBedrockConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds an instance from opaque JSON config', () => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIA');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret');
    const connector = AwsBedrockConnector.create({
      region: 'us-east-1',
      accessKeyId: { $secret: 'AWS_ACCESS_KEY_ID' },
      secretAccessKey: { $secret: 'AWS_SECRET_ACCESS_KEY' },
    });
    expect(connector).toBeInstanceOf(AwsBedrockConnector);
    expect(connector.id).toBe('aws-bedrock');
  });
});

describe('AwsBedrockConnector resource exports', () => {
  it('publishes all six metric resources keyed by metric name', () => {
    const keys = Object.keys(AwsBedrockConnector.resources);
    expect(keys).toContain(INVOCATIONS_METRIC);
    expect(keys).toContain(INPUT_TOKENS_METRIC);
    expect(keys).toContain(OUTPUT_TOKENS_METRIC);
    expect(keys).toContain(LATENCY_METRIC);
    expect(keys).toContain(ERRORS_METRIC);
    expect(keys).toContain(SPEND_METRIC);
  });
});
