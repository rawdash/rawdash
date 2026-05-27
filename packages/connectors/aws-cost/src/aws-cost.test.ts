import { AuthError, RateLimitError } from '@rawdash/connector-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AwsCostConnector,
  buildDailyCostSamples,
  buildForecastSamples,
  configFields,
  getCostWindow,
} from './aws-cost';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorage() {
  return {
    event: vi.fn().mockResolvedValue(undefined),
    entity: vi.fn().mockResolvedValue(undefined),
    metric: vi.fn().mockResolvedValue(undefined),
    edge: vi.fn().mockResolvedValue(undefined),
    distribution: vi.fn().mockResolvedValue(undefined),
    events: vi.fn().mockResolvedValue(undefined),
    entities: vi.fn().mockResolvedValue(undefined),
    metrics: vi.fn().mockResolvedValue(undefined),
    edges: vi.fn().mockResolvedValue(undefined),
    distributions: vi.fn().mockResolvedValue(undefined),
    queryEvents: vi.fn().mockResolvedValue([]),
    getEntity: vi.fn().mockResolvedValue(null),
    queryEntities: vi.fn().mockResolvedValue([]),
    queryMetrics: vi.fn().mockResolvedValue([]),
    traverse: vi.fn().mockResolvedValue([]),
    queryDistributions: vi.fn().mockResolvedValue([]),
    deleteOlderThan: vi.fn().mockResolvedValue({ rowsDeleted: 0 }),
  };
}

function makeConnector(
  settings: Partial<{
    roleArn: string;
    granularity: 'DAILY' | 'MONTHLY';
    groupBy: string[];
    lookbackDays: number;
  }> = {},
) {
  return new AwsCostConnector(
    { region: 'us-east-1', ...settings },
    {
      accessKeyId: 'AKIAEXAMPLE' as unknown as { $secret: string },
      secretAccessKey: 'secret' as unknown as { $secret: string },
    },
  );
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function xmlResponse(xml: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/xml' }),
    text: () => Promise.resolve(xml),
  } as Response;
}

function targetOf(init: RequestInit | undefined): string {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers['x-amz-target'] ?? '';
}

const STS_ASSUME_ROLE_XML = `<AssumeRoleResponse><AssumeRoleResult><Credentials>
  <AccessKeyId>ASIATEMP</AccessKeyId>
  <SecretAccessKey>tempsecret</SecretAccessKey>
  <SessionToken>tempsession</SessionToken>
  <Expiration>2026-01-01T00:00:00Z</Expiration>
</Credentials></AssumeRoleResult></AssumeRoleResponse>`;

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a config with access key + secret', () => {
    const result = configFields.safeParse({
      accessKeyId: { $secret: 'AWS_ACCESS_KEY_ID' },
      secretAccessKey: { $secret: 'AWS_SECRET_ACCESS_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('requires both accessKeyId and secretAccessKey', () => {
    const result = configFields.safeParse({
      accessKeyId: { $secret: 'AWS_ACCESS_KEY_ID' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts granularity, groupBy, lookbackDays, and role assumption fields', () => {
    const result = configFields.safeParse({
      accessKeyId: { $secret: 'AWS_ACCESS_KEY_ID' },
      secretAccessKey: { $secret: 'AWS_SECRET_ACCESS_KEY' },
      roleArn: 'arn:aws:iam::123456789012:role/r',
      externalId: 'rawdash-external-id',
      granularity: 'MONTHLY',
      groupBy: ['SERVICE', 'TAG:Environment'],
      lookbackDays: 30,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.granularity).toBe('MONTHLY');
      expect(result.data.groupBy).toEqual(['SERVICE', 'TAG:Environment']);
    }
  });

  it('rejects a plain string for secretAccessKey (must be a secret object)', () => {
    const result = configFields.safeParse({
      accessKeyId: { $secret: 'AWS_ACCESS_KEY_ID' },
      secretAccessKey: 'raw-secret',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildDailyCostSamples
// ---------------------------------------------------------------------------

describe('buildDailyCostSamples', () => {
  it('emits one sample per ResultsByTime entry for ungrouped totals', () => {
    const samples = buildDailyCostSamples(
      {
        ResultsByTime: [
          {
            TimePeriod: { Start: '2025-01-01', End: '2025-01-02' },
            Total: { UnblendedCost: { Amount: '12.34', Unit: 'USD' } },
            Estimated: false,
          },
        ],
      },
      'DAILY',
      undefined,
    );
    expect(samples).toHaveLength(1);
    expect(samples[0]!.name).toBe('aws_cost_daily');
    expect(samples[0]!.ts).toBe(Date.UTC(2025, 0, 1));
    expect(samples[0]!.value).toBeCloseTo(12.34);
    expect(samples[0]!.attributes['unit']).toBe('USD');
  });

  it('emits one sample per group and labels attributes from groupBy', () => {
    const samples = buildDailyCostSamples(
      {
        ResultsByTime: [
          {
            TimePeriod: { Start: '2025-01-01', End: '2025-01-02' },
            Groups: [
              {
                Keys: ['AmazonEC2', 'prod'],
                Metrics: { UnblendedCost: { Amount: '5.00', Unit: 'USD' } },
              },
              {
                Keys: ['AmazonS3', 'prod'],
                Metrics: { UnblendedCost: { Amount: '1.50', Unit: 'USD' } },
              },
            ],
            Estimated: true,
          },
        ],
      },
      'DAILY',
      ['SERVICE', 'TAG:Environment'],
    );
    expect(samples).toHaveLength(2);
    expect(samples[0]!.attributes['service']).toBe('AmazonEC2');
    expect(samples[0]!.attributes['tag_Environment']).toBe('prod');
    expect(samples[0]!.attributes['estimated']).toBe(true);
    expect(samples[1]!.value).toBeCloseTo(1.5);
  });

  it('skips entries with an unparseable start date', () => {
    const samples = buildDailyCostSamples(
      {
        ResultsByTime: [
          {
            TimePeriod: { Start: 'not-a-date', End: '2025-01-02' },
            Total: { UnblendedCost: { Amount: '1.00', Unit: 'USD' } },
          },
        ],
      },
      'DAILY',
      undefined,
    );
    expect(samples).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildForecastSamples
// ---------------------------------------------------------------------------

describe('buildForecastSamples', () => {
  it('emits one forecast sample per ForecastResultsByTime entry', () => {
    const samples = buildForecastSamples(
      {
        Total: { Amount: '300.00', Unit: 'USD' },
        ForecastResultsByTime: [
          {
            TimePeriod: { Start: '2025-02-01', End: '2025-03-01' },
            MeanValue: '300.00',
            PredictionIntervalLowerBound: '250.00',
            PredictionIntervalUpperBound: '350.00',
          },
        ],
      },
      'MONTHLY',
    );
    expect(samples).toHaveLength(1);
    expect(samples[0]!.name).toBe('aws_cost_forecast');
    expect(samples[0]!.value).toBeCloseTo(300);
    expect(samples[0]!.attributes['lowerBound']).toBeCloseTo(250);
    expect(samples[0]!.attributes['upperBound']).toBeCloseTo(350);
  });
});

// ---------------------------------------------------------------------------
// getCostWindow
// ---------------------------------------------------------------------------

describe('getCostWindow', () => {
  const now = Date.UTC(2025, 5, 15, 12, 0, 0);

  it('uses the configured lookback for a daily full sync', () => {
    const w = getCostWindow({ mode: 'full' }, 'DAILY', 90, now);
    expect(w.end).toBe('2025-06-16'); // tomorrow (exclusive)
    expect(w.start).toBe('2025-03-18'); // 90 days before end
  });

  it('uses a short trailing window for incremental syncs', () => {
    const w = getCostWindow({ mode: 'latest' }, 'DAILY', 90, now);
    expect(w.end).toBe('2025-06-16');
    expect(w.start).toBe('2025-06-13');
  });

  it('aligns to month boundaries for MONTHLY granularity', () => {
    const w = getCostWindow({ mode: 'full' }, 'MONTHLY', 90, now);
    expect(w.end).toBe('2025-07-01');
    expect(w.start).toBe('2025-04-01'); // three full months back
  });
});

// ---------------------------------------------------------------------------
// AwsCostConnector.sync
// ---------------------------------------------------------------------------

describe('AwsCostConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function installCeMock() {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const spy = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const target = targetOf(init);
      if (target.endsWith('GetCostAndUsage')) {
        return Promise.resolve(
          jsonResponse({
            ResultsByTime: [
              {
                TimePeriod: { Start: '2025-01-01', End: '2025-01-02' },
                Total: { UnblendedCost: { Amount: '10.00', Unit: 'USD' } },
                Estimated: false,
              },
            ],
          }),
        );
      }
      if (target.endsWith('GetCostForecast')) {
        return Promise.resolve(
          jsonResponse({
            Total: { Amount: '300.00', Unit: 'USD' },
            ForecastResultsByTime: [
              {
                TimePeriod: { Start: '2025-02-01', End: '2025-03-01' },
                MeanValue: '300.00',
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', spy);
    return { spy, calls };
  }

  it('writes daily and forecast metrics and signs with SigV4', async () => {
    const { calls } = installCeMock();
    const storage = makeStorage();

    const result = await makeConnector().sync({ mode: 'full' }, storage);
    expect(result.done).toBe(true);

    const names = storage.metrics.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(names).toContain('aws_cost_daily');
    expect(names).toContain('aws_cost_forecast');

    const ceCall = calls.find((c) => c.url.includes('ce.us-east-1'));
    expect(ceCall).toBeDefined();
    const headers = ceCall!.init?.headers as Record<string, string>;
    expect(headers['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/us-east-1\/ce\/aws4_request/,
    );
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('honors the resource allowlist (forecast only) and skips daily_cost', async () => {
    const { calls } = installCeMock();
    const storage = makeStorage();

    await makeConnector().sync(
      { mode: 'full', resources: new Set(['forecast']) },
      storage,
    );

    const targets = calls.map((c) => targetOf(c.init));
    expect(targets.some((t) => t.endsWith('GetCostForecast'))).toBe(true);
    expect(targets.some((t) => t.endsWith('GetCostAndUsage'))).toBe(false);
  });

  it('resumes from a saved cursor at the forecast phase', async () => {
    const { calls } = installCeMock();
    const storage = makeStorage();

    await makeConnector().sync(
      {
        mode: 'full',
        cursor: {
          phase: 'forecast',
          page: { start: '2025-01-01', end: '2025-04-01' },
        },
      },
      storage,
    );

    const targets = calls.map((c) => targetOf(c.init));
    expect(targets.some((t) => t.endsWith('GetCostAndUsage'))).toBe(false);
    expect(targets.some((t) => t.endsWith('GetCostForecast'))).toBe(true);
  });

  it('returns a resumable cursor when already aborted', async () => {
    installCeMock();
    const storage = makeStorage();
    const controller = new AbortController();
    controller.abort();

    const result = await makeConnector().sync(
      { mode: 'full' },
      storage,
      controller.signal,
    );
    expect(result.done).toBe(false);
    if (!result.done) {
      expect((result.cursor as { phase: string }).phase).toBe('daily_cost');
    }
  });

  it('assumes a role via STS when roleArn is set and uses the temp credentials', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const spy = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('sts.')) {
        return Promise.resolve(xmlResponse(STS_ASSUME_ROLE_XML));
      }
      const target = targetOf(init);
      if (target.endsWith('GetCostForecast')) {
        return Promise.resolve(
          jsonResponse({ Total: { Amount: '0', Unit: 'USD' } }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          ResultsByTime: [
            {
              TimePeriod: { Start: '2025-01-01', End: '2025-01-02' },
              Total: { UnblendedCost: { Amount: '1.00', Unit: 'USD' } },
            },
          ],
        }),
      );
    });
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await makeConnector({
      roleArn: 'arn:aws:iam::123456789012:role/r',
    }).sync({ mode: 'full' }, storage);

    expect(calls.some((c) => c.url.includes('sts.'))).toBe(true);
    const ceCall = calls.find((c) => c.url.includes('ce.us-east-1'));
    const headers = ceCall!.init?.headers as Record<string, string>;
    expect(headers['x-amz-security-token']).toBe('tempsession');
    expect(headers['authorization']).toContain('Credential=ASIATEMP/');
  });

  it('maps a ThrottlingException to a RateLimitError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            jsonResponse(
              { __type: 'ThrottlingException', message: 'slow down' },
              400,
            ),
          ),
        ),
    );
    const storage = makeStorage();
    await expect(
      makeConnector().sync({ mode: 'full' }, storage),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('maps an AccessDenied error to an AuthError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            jsonResponse(
              { __type: 'AccessDeniedException', message: 'no access' },
              400,
            ),
          ),
        ),
    );
    const storage = makeStorage();
    await expect(
      makeConnector().sync({ mode: 'full' }, storage),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

// ---------------------------------------------------------------------------
// AwsCostConnector.create
// ---------------------------------------------------------------------------

describe('AwsCostConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds an instance from opaque JSON config', () => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIA');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret');
    const connector = AwsCostConnector.create({
      accessKeyId: { $secret: 'AWS_ACCESS_KEY_ID' },
      secretAccessKey: { $secret: 'AWS_SECRET_ACCESS_KEY' },
      granularity: 'DAILY',
    });
    expect(connector).toBeInstanceOf(AwsCostConnector);
    expect(connector.id).toBe('aws-cost');
  });
});
