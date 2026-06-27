import { describe, expect, it } from 'vitest';

import {
  INSTALLS_BREAKDOWNS,
  type InstallsBreakdown,
  decodeUtf16Csv,
  installsMonthsForRange,
  installsObjectPath,
  normalizeInstallsBucketId,
  parseCsvRows,
  parseInstallsCsv,
} from './installs';

function breakdownFor(fileDimension: string): InstallsBreakdown {
  const b = INSTALLS_BREAKDOWNS.find((x) => x.fileDimension === fileDimension);
  if (!b) {
    throw new Error(`no breakdown for ${fileDimension}`);
  }
  return b;
}

function utf16leWithBom(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = code & 0xff;
    bytes[2 + i * 2 + 1] = (code >> 8) & 0xff;
  }
  return bytes;
}

describe('normalizeInstallsBucketId', () => {
  it('strips a gs:// prefix, path and trailing slash', () => {
    expect(normalizeInstallsBucketId('gs://pubsite_prod_rev_123/stats/')).toBe(
      'pubsite_prod_rev_123',
    );
    expect(normalizeInstallsBucketId('  pubsite_prod_rev_123  ')).toBe(
      'pubsite_prod_rev_123',
    );
    expect(normalizeInstallsBucketId('pubsite_prod_rev_123/')).toBe(
      'pubsite_prod_rev_123',
    );
  });
});

describe('installsObjectPath', () => {
  it('builds the stats/installs object path for a month and dimension', () => {
    expect(installsObjectPath('com.example.app', '202504', 'country')).toBe(
      'stats/installs/installs_com.example.app_202504_country.csv',
    );
  });
});

describe('installsMonthsForRange', () => {
  it('enumerates inclusive months spanning a range', () => {
    expect(installsMonthsForRange('2025-03-15', '2025-05-02')).toEqual([
      '202503',
      '202504',
      '202505',
    ]);
  });

  it('returns a single month when start and end share it', () => {
    expect(installsMonthsForRange('2025-04-01', '2025-04-30')).toEqual([
      '202504',
    ]);
  });

  it('crosses a year boundary', () => {
    expect(installsMonthsForRange('2024-12-20', '2025-01-10')).toEqual([
      '202412',
      '202501',
    ]);
  });

  it('returns empty for an inverted or malformed range', () => {
    expect(installsMonthsForRange('2025-05-01', '2025-04-01')).toEqual([]);
    expect(installsMonthsForRange('bad', '2025-04-01')).toEqual([]);
  });
});

describe('decodeUtf16Csv', () => {
  it('decodes UTF-16LE bytes and strips the BOM', () => {
    const decoded = decodeUtf16Csv(utf16leWithBom('Daté,Çountry'));
    expect(decoded).toBe('Daté,Çountry');
    expect(decoded.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe('parseCsvRows', () => {
  it('parses quoted fields with embedded commas and CRLF line endings', () => {
    const rows = parseCsvRows('a,b\r\n"x,y",z\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,y', 'z'],
    ]);
  });

  it('handles escaped double quotes', () => {
    const rows = parseCsvRows('h\n"a ""b"" c"');
    expect(rows).toEqual([['h'], ['a "b" c']]);
  });
});

describe('parseInstallsCsv', () => {
  const overview = breakdownFor('overview');
  const country = breakdownFor('country');

  it('maps overview rows to samples with daily device installs as the value', () => {
    const csv = [
      'Date,Package Name,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Installs on active devices',
      '2025-04-01,com.example.app,120,4,9,5000',
      '2025-04-02,com.example.app,131,7,3,5050',
    ].join('\n');

    const samples = parseInstallsCsv(csv, overview, 'com.example.app');
    expect(samples).toHaveLength(2);
    expect(samples[0]!.name).toBe('gplay_installs_overview_by_day');
    expect(samples[0]!.value).toBe(120);
    expect(samples[0]!.ts).toBe(Date.UTC(2025, 3, 1));
    expect(samples[0]!.attributes['date']).toBe('2025-04-01');
    expect(samples[0]!.attributes['package_name']).toBe('com.example.app');
    expect(samples[0]!.attributes['daily_device_installs']).toBe(120);
    expect(samples[0]!.attributes['daily_device_uninstalls']).toBe(4);
    expect(samples[0]!.attributes['daily_device_upgrades']).toBe(9);
    expect(samples[0]!.attributes['active_device_installs']).toBe(5000);
    expect(samples[0]!.attributes).not.toHaveProperty('country');
  });

  it('captures the breakdown dimension column for non-overview reports', () => {
    const csv = [
      'Date,Package Name,Country,Daily Device Installs,Daily Device Uninstalls',
      '2025-04-01,com.example.app,US,90,2',
      '2025-04-01,com.example.app,JP,30,1',
    ].join('\n');

    const samples = parseInstallsCsv(csv, country, 'com.example.app');
    expect(samples).toHaveLength(2);
    expect(samples[0]!.attributes['country']).toBe('US');
    expect(samples[0]!.value).toBe(90);
    expect(samples[1]!.attributes['country']).toBe('JP');
    expect(samples[1]!.value).toBe(30);
  });

  it('defaults missing or non-numeric metric cells to 0', () => {
    const csv = [
      'Date,Package Name,Daily Device Installs',
      '2025-04-01,com.example.app,',
    ].join('\n');
    const samples = parseInstallsCsv(csv, overview, 'com.example.app');
    expect(samples[0]!.attributes['daily_device_installs']).toBe(0);
    expect(samples[0]!.value).toBe(0);
  });

  it('skips rows without a valid ISO date and blank trailing rows', () => {
    const csv = [
      'Date,Package Name,Daily Device Installs',
      'Total,com.example.app,999',
      '2025-04-01,com.example.app,10',
      '',
    ].join('\n');
    const samples = parseInstallsCsv(csv, overview, 'com.example.app');
    expect(samples).toHaveLength(1);
    expect(samples[0]!.attributes['date']).toBe('2025-04-01');
  });

  it('returns no samples when the primary metric column is absent', () => {
    const csv = [
      'Date,Package Name,Daily Device Uninstalls,Daily Device Upgrades',
      '2025-04-01,com.example.app,4,9',
    ].join('\n');
    expect(parseInstallsCsv(csv, overview, 'com.example.app')).toEqual([]);
  });

  it('returns no samples for a header-only file', () => {
    expect(
      parseInstallsCsv(
        'Date,Package Name,Daily Device Installs',
        overview,
        'x',
      ),
    ).toEqual([]);
  });
});
