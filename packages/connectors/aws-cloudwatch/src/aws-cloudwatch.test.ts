import { AuthError, RateLimitError } from '@rawdash/connector-shared';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudWatchConnector, configFields } from './aws-cloudwatch';

const CONNECTOR_ID = 'aws-cloudwatch';

interface MockReply {
  status?: number;
  body: string;
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

const ASSUME_ROLE_XML = `<AssumeRoleResponse><AssumeRoleResult><Credentials>
  <AccessKeyId>ASIA_TEMP</AccessKeyId>
  <SecretAccessKey>temp-secret</SecretAccessKey>
  <SessionToken>session-token-xyz</SessionToken>
  <Expiration>2999-01-01T00:00:00Z</Expiration>
</Credentials></AssumeRoleResult></AssumeRoleResponse>`;

function staticConnector(): CloudWatchConnector {
  return new CloudWatchConnector(
    {
      region: 'us-east-1',
      metricQueries: [
        {
          id: 'cpu',
          namespace: 'AWS/EC2',
          metric: 'CPUUtilization',
          stat: 'Average',
          periodSeconds: 300,
          dimensions: { InstanceId: 'i-123' },
        },
        {
          id: 'net',
          namespace: 'AWS/EC2',
          metric: 'NetworkIn',
          stat: 'Sum',
          periodSeconds: 300,
        },
      ],
    },
    { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
  );
}

function metricsFor(storage: InMemoryStorage): Array<{
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, unknown>;
}> {
  return (
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
    ).metricStore.get(CONNECTOR_ID) ?? []
  );
}

describe('CloudWatchConnector sync (static credentials)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes one metric sample per data point, keyed by query', async () => {
    const spy = installFetch(() => ({
      body: metricDataXml([
        {
          id: 'cpu',
          label: 'CPUUtilization',
          timestamps: ['2024-01-01T00:00:00Z', '2024-01-01T00:05:00Z'],
          values: [12.5, 13.25],
        },
        {
          id: 'net',
          label: 'NetworkIn',
          timestamps: ['2024-01-01T00:00:00Z'],
          values: [1024],
        },
      ]),
    }));

    const storage = new InMemoryStorage();
    const result = await staticConnector().sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(result).toEqual({ done: true });

    const metrics = metricsFor(storage);
    expect(metrics).toHaveLength(3);

    const cpu = metrics.filter((m) => m.name === 'AWS/EC2/CPUUtilization');
    expect(cpu.map((m) => m.value)).toEqual([12.5, 13.25]);
    expect(cpu[0]!.attributes).toMatchObject({
      InstanceId: 'i-123',
      stat: 'Average',
      queryId: 'cpu',
    });
    expect(cpu[0]!.ts).toBe(Date.parse('2024-01-01T00:00:00Z'));

    const net = metrics.filter((m) => m.name === 'AWS/EC2/NetworkIn');
    expect(net.map((m) => m.value)).toEqual([1024]);

    // One signed POST to the regional CloudWatch endpoint.
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://monitoring.us-east-1.amazonaws.com/');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
    expect(headers['x-amz-date']).toBeDefined();
    expect(String(init.body)).toContain('Action=GetMetricData');
    expect(String(init.body)).toContain('MetricDataQueries.member.1.Id=cpu');
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
                id: 'cpu',
                label: 'CPUUtilization',
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
            id: 'cpu',
            label: 'CPUUtilization',
            timestamps: ['2024-01-01T00:05:00Z'],
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

    const cpu = metricsFor(storage).filter(
      (m) => m.name === 'AWS/EC2/CPUUtilization',
    );
    expect(cpu.map((m) => m.value)).toEqual([1, 2]);
  });

  it('skips data points whose value is not finite', async () => {
    installFetch(() => ({
      body: metricDataXml([
        {
          id: 'cpu',
          label: 'CPUUtilization',
          timestamps: ['2024-01-01T00:00:00Z', '2024-01-01T00:05:00Z'],
          values: [Number.NaN, 5],
        },
      ]),
    }));

    const storage = new InMemoryStorage();
    await staticConnector().sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const cpu = metricsFor(storage).filter(
      (m) => m.name === 'AWS/EC2/CPUUtilization',
    );
    expect(cpu.map((m) => m.value)).toEqual([5]);
  });
});

describe('CloudWatchConnector error mapping', () => {
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
    ).rejects.toBeInstanceOf(RateLimitError);
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
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe('CloudWatchConnector role assumption', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('assumes the role via STS and signs CloudWatch with the temp session token', async () => {
    const spy = installFetch((url) => {
      if (url.startsWith('https://sts.')) {
        return { body: ASSUME_ROLE_XML };
      }
      return {
        body: metricDataXml([
          {
            id: 'cpu',
            label: 'CPUUtilization',
            timestamps: ['2024-01-01T00:00:00Z'],
            values: [7],
          },
        ]),
      };
    });

    const connector = new CloudWatchConnector(
      {
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/rawdash',
        externalId: 'ext-1',
        metricQueries: [
          {
            id: 'cpu',
            namespace: 'AWS/EC2',
            metric: 'CPUUtilization',
            stat: 'Average',
            periodSeconds: 300,
          },
        ],
      },
      { accessKeyId: 'BASE', secretAccessKey: 'BASESECRET' },
    );

    const storage = new InMemoryStorage();
    await connector.sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(metricsFor(storage).map((m) => m.value)).toEqual([7]);

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

  it('caches assumed credentials across syncs', async () => {
    const spy = installFetch((url) =>
      url.startsWith('https://sts.')
        ? { body: ASSUME_ROLE_XML }
        : { body: metricDataXml([]) },
    );

    const connector = new CloudWatchConnector(
      {
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/rawdash',
        metricQueries: [
          {
            id: 'cpu',
            namespace: 'AWS/EC2',
            metric: 'CPUUtilization',
            stat: 'Average',
            periodSeconds: 300,
          },
        ],
      },
      { accessKeyId: 'BASE', secretAccessKey: 'BASESECRET' },
    );

    const storage = new InMemoryStorage();
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const stsCalls = spy.mock.calls.filter(([u]) =>
      String(u).startsWith('https://sts.'),
    );
    expect(stsCalls).toHaveLength(1);
  });
});

describe('configFields', () => {
  const baseQuery = {
    id: 'cpu',
    namespace: 'AWS/EC2',
    metric: 'CPUUtilization',
    stat: 'Average',
    periodSeconds: 300,
  };

  it('accepts static credentials', () => {
    const parsed = configFields.parse({
      region: 'us-east-1',
      accessKeyId: { $secret: 'AWS_ACCESS_KEY_ID' },
      secretAccessKey: { $secret: 'AWS_SECRET_ACCESS_KEY' },
      metricQueries: [baseQuery],
    });
    expect(parsed.region).toBe('us-east-1');
  });

  it('accepts role-assumption config', () => {
    expect(() =>
      configFields.parse({
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/rawdash',
        externalId: 'ext',
        metricQueries: [baseQuery],
      }),
    ).not.toThrow();
  });

  it('rejects config with no auth method', () => {
    expect(() =>
      configFields.parse({
        region: 'us-east-1',
        metricQueries: [baseQuery],
      }),
    ).toThrow();
  });

  it('rejects a query id that does not start with a lowercase letter', () => {
    expect(() =>
      configFields.parse({
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/rawdash',
        metricQueries: [{ ...baseQuery, id: 'BadId' }],
      }),
    ).toThrow();
  });

  it('rejects a period that is not a multiple of 60', () => {
    expect(() =>
      configFields.parse({
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/rawdash',
        metricQueries: [{ ...baseQuery, periodSeconds: 90 }],
      }),
    ).toThrow();
  });
});
