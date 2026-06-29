import {
  AuthError,
  type ConnectorLogger,
  RateLimitError,
  TransientError,
} from '@rawdash/connector-shared';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AwsSesConnector,
  EMAIL_STATS_METRIC,
  REPUTATION_METRIC,
  configFields,
} from './aws-ses';

const CONNECTOR_ID = 'aws-ses';

interface MockReply {
  status?: number;
  body: string;
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

function installFetch(
  handler: (url: string, init: RequestInit) => MockReply,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn((url: string | URL, init: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const reply = handler(u, init);
    return Promise.resolve(
      new Response(reply.body, {
        status: reply.status ?? 200,
        headers: { 'content-type': 'text/xml' },
      }),
    );
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function metricDataXml(
  results: Array<{
    id: string;
    label: string;
    timestamps: string[];
    values: number[];
    statusCode?: string;
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
        <StatusCode>${r.statusCode ?? 'Complete'}</StatusCode>
      </member>`,
    )
    .join('');
  const token = nextToken ? `<NextToken>${nextToken}</NextToken>` : '';
  return `<GetMetricDataResponse><GetMetricDataResult><MetricDataResults>${members}</MetricDataResults>${token}</GetMetricDataResult></GetMetricDataResponse>`;
}

const ASSUME_ROLE_XML = `<AssumeRoleResponse><AssumeRoleResult><Credentials>
  <AccessKeyId>ASIA_TEMP</AccessKeyId>
  <SecretAccessKey>temp-secret</SecretAccessKey>
  <SessionToken>session-token-xyz</SessionToken>
  <Expiration>2999-01-01T00:00:00Z</Expiration>
</Credentials></AssumeRoleResult></AssumeRoleResponse>`;

function staticConnector(
  settings?: { configurationSets?: string[]; lookbackDays?: number },
  logger?: ConnectorLogger,
): AwsSesConnector {
  return new AwsSesConnector(
    { region: 'us-east-1', ...settings },
    { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
    logger ? { logger } : undefined,
  );
}

function metricsFor(
  storage: InMemoryStorage,
  name?: string,
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
  return name ? all.filter((m) => m.name === name) : all;
}

describe('AwsSesConnector sync (static credentials)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes email-stats and reputation samples tagged by kind', async () => {
    const spy = installFetch((_url, init) => {
      const params = new URLSearchParams(String(init.body));
      const results: Array<{
        id: string;
        label: string;
        timestamps: string[];
        values: number[];
      }> = [];
      for (let i = 1; ; i++) {
        const id = params.get(`MetricDataQueries.member.${i}.Id`);
        if (id === null) {
          break;
        }
        const metric = params.get(
          `MetricDataQueries.member.${i}.MetricStat.Metric.MetricName`,
        )!;
        results.push({
          id,
          label: metric,
          timestamps: ['2024-01-01T00:00:00Z'],
          values: [metric === 'Send' ? 100 : metric.includes('Rate') ? 0.5 : 1],
        });
      }
      return { body: metricDataXml(results) };
    });

    const storage = new InMemoryStorage();
    const result = await staticConnector().sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(result).toEqual({ done: true });

    const emailStats = metricsFor(storage, EMAIL_STATS_METRIC);
    const sends = emailStats.find((m) => m.attributes['kind'] === 'sends')!;
    expect(sends.value).toBe(100);
    expect(sends.attributes).toMatchObject({
      kind: 'sends',
      configurationSet: 'all',
      stat: 'Sum',
    });
    expect(sends.ts).toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(new Set(emailStats.map((m) => m.attributes['kind']))).toEqual(
      new Set([
        'sends',
        'deliveries',
        'bounces',
        'complaints',
        'opens',
        'clicks',
      ]),
    );

    const reputation = metricsFor(storage, REPUTATION_METRIC);
    expect(new Set(reputation.map((m) => m.attributes['kind']))).toEqual(
      new Set(['bounce_rate', 'complaint_rate']),
    );
    expect(reputation[0]!.value).toBe(0.5);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://monitoring.us-east-1.amazonaws.com/');
    expect(String(init.body)).toContain('Action=GetMetricData');
    expect(String(init.body)).toContain(
      'MetricStat.Metric.Namespace=AWS%2FSES',
    );
  });

  it('adds a per-configuration-set query with the SES dimension', async () => {
    const spy = installFetch(() => ({ body: metricDataXml([]) }));
    await staticConnector({ configurationSets: ['marketing'] }).sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );
    const body = String(spy.mock.calls[0]![1].body);
    expect(body).toContain(
      encodeURIComponent('ses:configuration-set').replace(/%20/g, '+'),
    );
    expect(body).toContain('Dimensions.member.1.Value=marketing');
  });

  it('does not wipe older history when an incremental sync returns no data points', async () => {
    installFetch(() => ({ body: metricDataXml([]) }));

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    const oldTs = Date.now() - 90 * 86_400_000;
    await handle.metrics(
      [
        {
          name: EMAIL_STATS_METRIC,
          ts: oldTs,
          value: 42,
          attributes: { kind: 'sends', configurationSet: 'all' },
        },
      ],
      { names: [EMAIL_STATS_METRIC] },
    );

    await staticConnector().sync({ mode: 'latest' }, handle);

    const surviving = await handle.queryMetrics({ name: EMAIL_STATS_METRIC });
    expect(surviving.map((m) => m.ts)).toContain(oldTs);
  });

  it('follows NextToken across pages', async () => {
    let call = 0;
    installFetch(() => {
      call += 1;
      if (call === 1) {
        return {
          body: metricDataXml(
            [
              {
                id: 'm0',
                label: 'Send',
                timestamps: ['2024-01-01T00:00:00Z'],
                values: [1],
              },
            ],
            'page-2',
          ),
        };
      }
      return {
        body: metricDataXml([
          {
            id: 'm0',
            label: 'Send',
            timestamps: ['2024-01-02T00:00:00Z'],
            values: [2],
          },
        ]),
      };
    });

    const storage = new InMemoryStorage();
    await staticConnector().sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const sends = metricsFor(storage, EMAIL_STATS_METRIC).filter(
      (m) => m.attributes['kind'] === 'sends',
    );
    expect(sends.map((m) => m.value)).toEqual([1, 2]);
  });

  it('skips data points whose value is not finite', async () => {
    installFetch((_url, init) => {
      const params = new URLSearchParams(String(init.body));
      const firstId = params.get('MetricDataQueries.member.1.Id')!;
      return {
        body: metricDataXml([
          {
            id: firstId,
            label: 'Send',
            timestamps: ['2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z'],
            values: [Number.NaN, 5],
          },
        ]),
      };
    });

    const storage = new InMemoryStorage();
    await staticConnector().sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const sends = metricsFor(storage, EMAIL_STATS_METRIC).filter(
      (m) => m.attributes['kind'] === 'sends',
    );
    expect(sends.map((m) => m.value)).toEqual([5]);
  });
});

describe('AwsSesConnector resource gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queries only reputation metrics when only that resource is requested', async () => {
    const spy = installFetch(() => ({ body: metricDataXml([]) }));
    await staticConnector().sync(
      {
        mode: 'full',
        since: '2024-01-01T00:00:00Z',
        resources: new Set([REPUTATION_METRIC]),
      },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );
    const body = String(spy.mock.calls[0]![1].body);
    expect(body).toContain('Reputation.BounceRate');
    expect(body).not.toContain('MetricName=Send');
  });

  it('does not call the API when no configured resource is requested', async () => {
    const spy = installFetch(() => ({ body: metricDataXml([]) }));
    const result = await staticConnector().sync(
      {
        mode: 'full',
        since: '2024-01-01T00:00:00Z',
        resources: new Set(['something_else']),
      },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );
    expect(result).toEqual({ done: true });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('AwsSesConnector result status codes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('warns and throws TransientError on InternalError', async () => {
    installFetch((_url, init) => {
      const id = new URLSearchParams(String(init.body)).get(
        'MetricDataQueries.member.1.Id',
      )!;
      return {
        body: metricDataXml([
          {
            id,
            label: 'Send',
            timestamps: ['2024-01-01T00:00:00Z'],
            values: [1],
            statusCode: 'InternalError',
          },
        ]),
      };
    });

    const { logger, warnings } = recordingLogger();
    await expect(
      staticConnector(undefined, logger).sync(
        { mode: 'full', since: '2024-01-01T00:00:00Z' },
        new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
      ),
    ).rejects.toMatchObject({ name: TransientError.name });

    expect(
      warnings.find((w) => w.event === 'metric result internal error'),
    ).toBeDefined();
  });

  it('warns on Forbidden without throwing', async () => {
    installFetch((_url, init) => {
      const id = new URLSearchParams(String(init.body)).get(
        'MetricDataQueries.member.1.Id',
      )!;
      return {
        body: metricDataXml([
          {
            id,
            label: 'Send',
            timestamps: [],
            values: [],
            statusCode: 'Forbidden',
          },
        ]),
      };
    });

    const { logger, warnings } = recordingLogger();
    const result = await staticConnector(undefined, logger).sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );

    expect(result).toEqual({ done: true });
    expect(
      warnings.find((w) => w.event === 'metric result forbidden'),
    ).toBeDefined();
  });
});

describe('AwsSesConnector error mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps a Throttling error to RateLimitError', async () => {
    installFetch(() => ({
      status: 400,
      body: '<ErrorResponse><Error><Code>Throttling</Code><Message>Rate exceeded</Message></Error></ErrorResponse>',
    }));
    await expect(
      staticConnector().sync(
        { mode: 'full', since: '2024-01-01T00:00:00Z' },
        new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
      ),
    ).rejects.toMatchObject({ name: RateLimitError.name });
  });

  it('maps an AccessDenied error to AuthError', async () => {
    installFetch(() => ({
      status: 400,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>nope</Message></Error></ErrorResponse>',
    }));
    await expect(
      staticConnector().sync(
        { mode: 'full', since: '2024-01-01T00:00:00Z' },
        new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
      ),
    ).rejects.toMatchObject({ name: AuthError.name });
  });
});

describe('AwsSesConnector role assumption', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('assumes the role via STS and signs CloudWatch with the temp session token', async () => {
    const spy = installFetch((url) => {
      if (url.startsWith('https://sts.')) {
        return { body: ASSUME_ROLE_XML };
      }
      return { body: metricDataXml([]) };
    });

    const connector = new AwsSesConnector(
      {
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/rawdash',
        externalId: 'ext-1',
      },
      { accessKeyId: 'BASE', secretAccessKey: 'BASESECRET' },
    );

    await connector.sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );

    const stsCall = spy.mock.calls.find(([u]) =>
      String(u).startsWith('https://sts.'),
    )!;
    expect(String(stsCall[1].body)).toContain('Action=AssumeRole');
    expect(String(stsCall[1].body)).toContain('ExternalId=ext-1');

    const cwCall = spy.mock.calls.find(([u]) =>
      String(u).startsWith('https://monitoring.'),
    )!;
    const cwHeaders = cwCall[1].headers as Record<string, string>;
    expect(cwHeaders['x-amz-security-token']).toBe('session-token-xyz');
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

  it('accepts role-assumption config with configuration sets', () => {
    expect(() =>
      configFields.parse({
        region: 'us-west-2',
        roleArn: 'arn:aws:iam::123456789012:role/rawdash',
        externalId: 'ext',
        configurationSets: ['marketing', 'transactional'],
      }),
    ).not.toThrow();
  });

  it('rejects config with no auth method', () => {
    expect(() => configFields.parse({ region: 'us-east-1' })).toThrow();
  });
});
