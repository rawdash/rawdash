import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AppStoreConnectConnector,
  computeSalesReportDates,
  configFields,
  parseSalesReportTsv,
  salesReportWindow,
  signES256Jwt,
} from './app-store-connect';

const INSTALLS_METRIC = 'app_store_connect_app_installs';

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

describe('configFields', () => {
  it('accepts a minimal valid config', () => {
    const result = configFields.safeParse({
      issuerId: '69a6de7f-0000-0000-0000-000000000000',
      keyId: 'ABC1234DEF',
      privateKey: { $secret: 'APPSTORECONNECT_P8' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a config with vendorNumber and resources allowlist', () => {
    const result = configFields.safeParse({
      issuerId: '69a6de7f-0000-0000-0000-000000000000',
      keyId: 'ABC1234DEF',
      privateKey: { $secret: 'APPSTORECONNECT_P8' },
      vendorNumber: '85912345',
      resources: ['apps', 'app_installs'],
      salesBackfillDays: 7,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown resource', () => {
    const result = configFields.safeParse({
      issuerId: 'a',
      keyId: 'b',
      privateKey: { $secret: 'X' },
      resources: ['unknown'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a privateKey passed as a plain string', () => {
    const result = configFields.safeParse({
      issuerId: 'a',
      keyId: 'b',
      privateKey: 'literal',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric vendorNumber', () => {
    const result = configFields.safeParse({
      issuerId: 'a',
      keyId: 'b',
      privateKey: { $secret: 'X' },
      vendorNumber: 'not-a-number',
    });
    expect(result.success).toBe(false);
  });
});

describe('signES256Jwt', () => {
  it('produces a JWT with three base64url segments', async () => {
    const jwt = await signES256Jwt({
      header: { alg: 'ES256', kid: 'ABC1234DEF', typ: 'JWT' },
      payload: {
        iss: '69a6de7f-0000-0000-0000-000000000000',
        iat: 1700000000,
        exp: 1700000900,
        aud: 'appstoreconnect-v1',
      },
      privateKeyPem: TEST_KEY,
    });
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    const header = JSON.parse(
      atob(parts[0]!.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { alg: string; kid: string };
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe('ABC1234DEF');
  });
});

describe('parseSalesReportTsv', () => {
  const sampleTsv = [
    [
      'Provider',
      'Provider Country',
      'SKU',
      'Developer',
      'Title',
      'Version',
      'Product Type Identifier',
      'Units',
      'Developer Proceeds',
      'Begin Date',
      'End Date',
      'Customer Currency',
      'Country Code',
      'Currency of Proceeds',
      'Apple Identifier',
      'Customer Price',
      'Promo Code',
      'Parent Identifier',
      'Subscription',
      'Period',
      'Category',
    ].join('\t'),
    [
      'APPLE',
      'US',
      'SKU1',
      'My Dev',
      'My App',
      '1.0',
      '1',
      '10',
      '7.00',
      '12/01/2025',
      '12/01/2025',
      'USD',
      'US',
      'USD',
      '12345',
      '9.99',
      '',
      '',
      '',
      '',
      'Apps',
    ].join('\t'),
    [
      'APPLE',
      'US',
      'SKU1',
      'My Dev',
      'My App',
      '1.0',
      '1',
      '4',
      '2.10',
      '12/01/2025',
      '12/01/2025',
      'EUR',
      'DE',
      'EUR',
      '12345',
      '0.99',
      '',
      '',
      '',
      '',
      'Apps',
    ].join('\t'),
  ].join('\n');

  it('emits one install sample per row', () => {
    const samples = parseSalesReportTsv(
      sampleTsv,
      'app_store_connect_app_installs',
    );
    expect(samples).toHaveLength(2);
    expect(samples[0]!.value).toBe(10);
    expect(samples[0]!.attributes).toMatchObject({
      appId: '12345',
      countryCode: 'US',
      productTypeIdentifier: '1',
    });
    expect(samples[1]!.value).toBe(4);
    expect(samples[1]!.attributes).toMatchObject({
      countryCode: 'DE',
    });
  });

  it('emits total proceeds (per-unit proceeds times units) per row with native currency', () => {
    const samples = parseSalesReportTsv(
      sampleTsv,
      'app_store_connect_app_revenue',
    );
    expect(samples).toHaveLength(2);
    expect(samples[0]!.value).toBeCloseTo(70);
    expect(samples[0]!.attributes).toMatchObject({
      currency: 'USD',
      countryCode: 'US',
    });
    expect(samples[1]!.value).toBeCloseTo(8.4);
    expect(samples[1]!.attributes).toMatchObject({
      currency: 'EUR',
    });
  });

  it('multiplies developer proceeds by units (5 units at 2.00 yields 10.00)', () => {
    const tsv = [
      [
        'Begin Date',
        'End Date',
        'Country Code',
        'Apple Identifier',
        'Units',
        'Developer Proceeds',
        'Currency of Proceeds',
        'Product Type Identifier',
      ].join('\t'),
      ['12/01/2025', '12/01/2025', 'US', '12345', '5', '2.00', 'USD', '1'].join(
        '\t',
      ),
    ].join('\n');
    const samples = parseSalesReportTsv(tsv, 'app_store_connect_app_revenue');
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBeCloseTo(10);
  });

  it('subtracts refund rows (negative units) from revenue', () => {
    const tsv = [
      [
        'Begin Date',
        'End Date',
        'Country Code',
        'Apple Identifier',
        'Units',
        'Developer Proceeds',
        'Currency of Proceeds',
        'Product Type Identifier',
      ].join('\t'),
      [
        '12/01/2025',
        '12/01/2025',
        'US',
        '12345',
        '-1',
        '2.00',
        'USD',
        '1',
      ].join('\t'),
    ].join('\n');
    const samples = parseSalesReportTsv(tsv, 'app_store_connect_app_revenue');
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBeCloseTo(-2);
  });

  it('warns and drops the report when a required column is missing', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const samples = parseSalesReportTsv(
      'Begin Date\tCountry Code\n12/01/2025\tUS',
      'app_store_connect_app_installs',
      logger,
    );
    expect(samples).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [, fields] = logger.warn.mock.calls[0]!;
    expect(fields.missing).toContain('Apple Identifier');
    expect(fields.missing).toContain('Units');
    expect(fields.header).toBe('Begin Date\tCountry Code');
  });

  it('parses MM/DD/YYYY begin dates as UTC midnight', () => {
    const samples = parseSalesReportTsv(
      sampleTsv,
      'app_store_connect_app_installs',
    );
    const ms = Date.UTC(2025, 11, 1);
    expect(samples[0]!.ts).toBe(ms);
  });

  it('returns no samples when the header is missing required columns', () => {
    expect(
      parseSalesReportTsv(
        'Begin Date\tCountry Code\n12/01/2025\tUS',
        'app_store_connect_app_installs',
      ),
    ).toEqual([]);
  });

  it('returns no samples for empty or single-line input', () => {
    expect(parseSalesReportTsv('', 'app_store_connect_app_installs')).toEqual(
      [],
    );
    expect(
      parseSalesReportTsv(
        'Begin Date\tApple Identifier',
        'app_store_connect_app_installs',
      ),
    ).toEqual([]);
  });

  it('skips rows whose numeric column does not parse', () => {
    const tsv = [
      [
        'Begin Date',
        'End Date',
        'Country Code',
        'Apple Identifier',
        'Units',
        'Developer Proceeds',
        'Currency of Proceeds',
        'Product Type Identifier',
      ].join('\t'),
      [
        '12/01/2025',
        '12/01/2025',
        'US',
        '12345',
        'NOTANUMBER',
        '7',
        'USD',
        '1',
      ].join('\t'),
    ].join('\n');
    expect(parseSalesReportTsv(tsv, 'app_store_connect_app_installs')).toEqual(
      [],
    );
  });
});

describe('computeSalesReportDates', () => {
  it('returns one date per day across the requested backfill window', () => {
    const dates = computeSalesReportDates(
      { mode: 'full', since: '2025-01-01T00:00:00Z' },
      {},
    );
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('honours an explicit salesBackfillDays setting', () => {
    const dates = computeSalesReportDates(
      { mode: 'full' },
      { salesBackfillDays: 5 },
    );
    expect(dates.length).toBe(6);
  });

  it('shrinks the window to a few days in latest mode', () => {
    const dates = computeSalesReportDates({ mode: 'latest' }, {});
    expect(dates.length).toBeLessThanOrEqual(3);
  });
});

describe('salesReportWindow', () => {
  it('spans UTC midnight of the first date to the end of the last date', () => {
    const window = salesReportWindow([
      '2025-12-01',
      '2025-12-02',
      '2025-12-03',
    ]);
    expect(window).toEqual({
      start: Date.UTC(2025, 11, 1),
      end: Date.UTC(2025, 11, 3) + 86_400_000 - 1,
    });
  });

  it('covers the single day for a one-date window', () => {
    const window = salesReportWindow(['2025-12-01']);
    expect(window).toEqual({
      start: Date.UTC(2025, 11, 1),
      end: Date.UTC(2025, 11, 1) + 86_400_000 - 1,
    });
  });

  it('returns undefined for an empty window', () => {
    expect(salesReportWindow([])).toBeUndefined();
  });
});

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body ?? null), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function recordCalls(spy: ReturnType<typeof vi.fn>): MockCall[] {
  return spy.mock.calls.map((c: unknown[]) => {
    const init = (c[1] ?? {}) as RequestInit;
    return {
      url: String(c[0]),
      method: (init.method ?? 'GET').toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
    };
  });
}

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

function connector(
  overrides: {
    resources?: string[];
    vendorNumber?: string;
  } = {},
) {
  return new AppStoreConnectConnector(
    {
      ...(overrides.resources
        ? { resources: overrides.resources as never }
        : {}),
      ...(overrides.vendorNumber
        ? { vendorNumber: overrides.vendorNumber }
        : {}),
    },
    {
      issuerId: '69a6de7f-0000-0000-0000-000000000000',
      keyId: 'ABC1234DEF',
      privateKey: TEST_KEY as unknown as { $secret: string },
    },
  );
}

describe('AppStoreConnectConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes app entities returned by /v1/apps', async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = String(url);
      if (u.startsWith('https://api.appstoreconnect.apple.com/v1/apps')) {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                id: '111',
                type: 'apps',
                attributes: {
                  name: 'Acme',
                  bundleId: 'com.acme.app',
                  sku: 'ACME-1',
                  primaryLocale: 'en-US',
                },
              },
              {
                id: '222',
                type: 'apps',
                attributes: {
                  name: 'Other',
                  bundleId: 'com.acme.other',
                  sku: 'OTHER-1',
                  primaryLocale: 'en-US',
                },
              },
            ],
            links: {},
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['apps'] }).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(2);
    const types = storage.entity.mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    );
    expect(types).toEqual(['app_store_connect_app', 'app_store_connect_app']);
  });

  it('sends a Bearer Authorization header on each request', async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ data: [], links: {} })),
      );
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['apps'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const headers = recordCalls(fetchSpy)[0]!.headers;
    expect(headers['authorization']).toMatch(/^Bearer /);
  });

  it('skips sales metrics when vendorNumber is not configured', async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ data: [], links: {} })),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['app_installs'] }).sync(
      { mode: 'full' },
      storage,
    );

    expect(storage.metrics).toHaveBeenCalledWith([], {
      names: ['app_store_connect_app_installs'],
    });
    const salesCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/v1/salesReports'),
    );
    expect(salesCalls).toHaveLength(0);
  });

  it('scopes the sales metric write to the fetched report window', async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 404 })),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({
      resources: ['app_installs'],
      vendorNumber: '85912345',
    }).sync({ mode: 'full' }, storage);

    expect(storage.metrics).toHaveBeenCalledTimes(1);
    const [samples, scope] = storage.metrics.mock.calls[0]!;
    expect(samples).toEqual([]);
    expect(scope.names).toEqual(['app_store_connect_app_installs']);
    expect(scope.replaceWindow.start).toBeLessThan(scope.replaceWindow.end);
  });

  it('does not wipe older history when an incremental sync returns no reports', async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 404 })),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('app-store-connect');
    const oldTs = Date.now() - 60 * 86_400_000;
    await handle.metrics([
      {
        name: INSTALLS_METRIC,
        ts: oldTs,
        value: 106,
        attributes: { appId: '12345', countryCode: 'US' },
      },
    ]);

    await connector({
      resources: ['app_installs'],
      vendorNumber: '85912345',
    }).sync({ mode: 'latest' }, handle);

    const rows = await handle.queryMetrics({ name: INSTALLS_METRIC });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(106);
    expect(rows[0]!.ts).toBe(oldTs);
  });
});
